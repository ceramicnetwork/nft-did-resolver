import type {
  DIDResolutionResult,
  DIDResolutionOptions,
  DIDDocument,
  ParsedDID,
  Resolver,
  ResolverRegistry
} from 'did-resolver'
import type { DocState, CeramicApi } from "@ceramicnetwork/common"
import { ChainID, AccountID } from 'caip'
import fetch from 'cross-fetch'
import * as u8a from 'uint8arrays'

const erc721OwnerOf = async (asset: AssetID, rpcUrl: string): Promise<any> =>  {
  const id = u8a.toString(u8a.fromString(asset.tokenId, 'base10'), 'base16')
  const opts = {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params:[{
        data: '0x6352211e' + '0'.repeat(64 - id.length) + id,
        to: asset.reference
      }, 'latest']
    })
  }
  const r = await fetch(rpcUrl, opts)
  if (r.ok) {
    const { result, error } = await r.json()
    if (error) throw new Error(error.message)
    // convert to ethereum address
    return '0x' + result.slice(26)
  } else {
    throw new Error('Not a valid NFT id')
  }
}


const DID_LD_JSON = 'application/did+ld+json'
const DID_JSON = 'application/did+json'

/**
 * Gets the unix timestamp from the `versionTime` parameter.
 * @param query
 */
function getVersionTime(query = ''): number | undefined {
  const versionTime = query.split('&').find(e => e.includes('versionTime'))
  if (versionTime) {
    return Math.floor((new Date(versionTime.split('=')[1])).getTime() / 1000)
  }
}

// TODO - should be part of the caip library
interface AssetID {
  chainId: ChainID
  namespace: string
  reference: string
  tokenId: string
}

function idToAsset(id: string): AssetID {
  // TODO use caip package to do this once it supports assetids
  const [chainid, assetType, tokenId] = id.split('_')
  const [namespace, reference] = assetType.split('.')
  return {
    chainId: ChainID.parse(chainid.replace('.', ':')),
    namespace,
    reference,
    tokenId
  }
}

async function assetToAccount(asset: AssetID, timestamp: string, rpcUrl: string): Promise<AccountID> {
  const owner = await erc721OwnerOf(asset, rpcUrl)
  return new AccountID({
    chainId: asset.chainId,
    address: owner
  })
}

async function accountToDid(account: AccountID, atTime: number, ceramic: CeramicApi): Promise<string | null> {
  const doc = await ceramic.createDocument('caip10-link', {
    metadata: {
      family: 'caip10-link',
      controllers: [AccountID.format(account)]
    }
  })
  // TODO - enable a way to do this with one request
  //const docAtTime = await ceramic.loadDocument(doc.id, { atTime })
  return doc?.content
}

function wrapDocument(did: string, account: AccountID, controller?: string): DIDDocument {
  const doc: DIDDocument = {
    id: did,
    verificationMethod: [{
      id: did + '#owner',
      type: 'BlockchainVerificationMethod2021',
      controller: did,
      blockchainAccountId: account.toString()
    }]
  }
  if (controller) {
    doc.controller = controller
  }
  return doc
}

async function resolve(
  did: string,
  methodId: string,
  timestamp: number,
  config: NftResovlerConfig
): Promise<DIDResolutionResult> {
  const asset = idToAsset(methodId)
  const ethRpc = config.ethereumRpcs[ChainID.format(asset.chainId)]
  const account = await assetToAccount(asset, timestamp, ethRpc)
  const controller = await accountToDid(account, timestamp, config.ceramic)
  return {
    didResolutionMetadata: { contentType: DID_JSON },
    didDocument: wrapDocument(did, account, controller),
    didDocumentMetadata: {}
  }
}

interface EthereumRpcEndpoints {
  [chainId: string]: string
}

interface NftResovlerConfig {
  ceramic: CeramicApi
  ethereumRpcs: EthereumRpcEndpoints
}

export default {
  getResolver: (config: NftResovlerConfig): ResolverRegistry => {
    if (!config.ceramic || !config.ethereumRpcs) {
      throw new Error('Invalid config for nft-did-resolver')
    }
    return {
      nft: async (did: string, parsed: ParsedDID, resolver: Resolver, options: DIDResolutionOptions): Promise<DIDResolutionResult> => {
        const contentType = options.accept || DID_JSON
        try {
          const timestamp = getVersionTime(parsed.query)
          const didResult = await resolve(did, parsed.id, timestamp, config)

          if (contentType === DID_LD_JSON) {
            didResult.didDocument['@context'] = 'https://w3id.org/did/v1'
            didResult.didResolutionMetadata.contentType = DID_LD_JSON
          } else if (contentType !== DID_JSON) {
            didResult.didDocument = null
            didResult.didDocumentMetadata = {}
            delete didResult.didResolutionMetadata.contentType
            didResult.didResolutionMetadata.error = 'representationNotSupported'
          }
          return didResult
        } catch (e) {
          return {
            didResolutionMetadata: {
              error: 'invalidDid',
              message: e.toString()
            },
            didDocument: null,
            didDocumentMetadata: {}
          }
        }
      }
    }
  }
}
