import type {
  DIDResolutionResult,
  DIDResolutionOptions,
  DIDDocument,
  ParsedDID,
  Resolver,
  ResolverRegistry,
  VerificationMethod
} from 'did-resolver';
import type { CeramicApi } from '@ceramicnetwork/common';
import { ChainID, AccountID } from 'caip';
import { blockAtTime, erc1155OwnersOf, erc721OwnerOf, fetchQueryData, isWithinLastBlock } from './subgraphUtils';
import { DIDDocumentMetadata } from 'did-resolver';

const DID_LD_JSON = 'application/did+ld+json'
const DID_JSON = 'application/did+json'


// TODO - should be part of the caip library
export interface AssetID {
  chainId: ChainID
  namespace: string
  reference: string
  tokenId: string
}

function idToAsset(id: string): AssetID {
  // TODO use caip package to do this once it supports assetIds
  const [chainid, assetType, tokenId] = id.split('_');
  const [namespace, reference] = assetType.split('.');

  if (!['erc721', 'erc1155'].includes(namespace)) 
    throw new Error('Not a valid NFT namespace');
  
  return {
    chainId: ChainID.parse(chainid.replace('.', ':')),
    namespace,
    reference,
    tokenId
  }
}

async function assetToAccount(asset: AssetID, timestamp: number, customSubgraph?: SubGraphUrls): Promise<AccountID[]> {
  // we want to query what block is at the timestamp IFF it is an (older) existing timestamp
  let queryBlock: number = undefined;
  if (timestamp && !isWithinLastBlock(timestamp)) {
    queryBlock = await blockAtTime(timestamp);
  }

  let owners: string[];
  if (asset.namespace === ErcNamespace.ERC721) {
    owners = [ await erc721OwnerOf(asset, queryBlock, customSubgraph?.erc721) ];
  } else {
    owners = await erc1155OwnersOf(asset, queryBlock, customSubgraph?.erc1155);
  }

  return owners.slice().map(owner => 
    new AccountID({
      chainId: asset.chainId,
      address: owner
    })
  );
}

async function createCaip10Link(account: AccountID, ceramic: CeramicApi): Promise<string | null> {
  const doc = await ceramic.createDocument('caip10-link', {
    metadata: {
      family: 'caip10-link',
      controllers: [AccountID.format(account)]
    }
  });
  // TODO - enable a way to do this with one request
  //const docAtTime = await ceramic.loadDocument(doc.id, { atTime })
  return doc?.content;
}

/**
 * Creates CAIP-10 links for each account to be used as controllers. 
 * Since there may be many owners for a given NFT (only ERC1155 for now), there can be many
 * controllers of that DID document.
 */
async function accountsToDids(
  accounts: AccountID[], 
  atTime: number, 
  ceramic: CeramicApi
): Promise<string[] | null> {
  const controllers: string[] = [];

  for (const account of accounts) {
    const caip10Link = await createCaip10Link(account, ceramic);
    if (caip10Link) controllers.push(caip10Link);
  }

  return controllers.length > 0 ? controllers : null;
}

function wrapDocument(did: string, accounts: AccountID[], controllers?: string[]): DIDDocument {
  // Each of the owning accounts is a verification method (at the point in time)
  const verificationMethods = accounts.slice().map(account => {
    return {
      id: `${did}#owner`,
      type: 'BlockchainVerificationMethod2021',
      controller: did,
      blockchainAccountId: account.toString()
    } as VerificationMethod;
  });

  const doc: DIDDocument = {
    id: did,
    verificationMethod: [...verificationMethods]
  }
  
  // Controllers should only be an array when there're more than one
  if (controllers) doc.controller = controllers.length === 1 ? controllers[0] : controllers;
  
  return doc;
}

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

export enum ErcNamespace {
  ERC721 = 'erc721',
  ERC1155 = 'erc1155'
}

type SubGraphUrls = {
  [namespace in ErcNamespace]?: string;
}

/**
 * When passing in a custom subgraph url, it must conform to the same standards as 
 * represented by the included ERC721 and ERC1155 subgraphs
 */
export interface NftResovlerConfig {
  ceramic: CeramicApi;
  subGraphUrls?: SubGraphUrls;
}

async function resolve(
  did: string,
  methodId: string,
  timestamp: number,
  config: NftResovlerConfig
): Promise<DIDResolutionResult> {
  const asset = idToAsset(methodId);
  // for 1155s, there can be many accounts that own a single asset
  const owningAccounts = await assetToAccount(asset, timestamp, config.subGraphUrls);
  const controllers = await accountsToDids(owningAccounts, timestamp, config.ceramic);
  const metadata: DIDDocumentMetadata = {};

  // TODO create, update, versionId
  if (timestamp) {
    const dateString = (new Date(timestamp * 1000)).toISOString();
    metadata.versionTime = dateString;
  }

  return {
    didResolutionMetadata: { contentType: DID_JSON },
    didDocument: wrapDocument(did, owningAccounts, controllers),
    didDocumentMetadata: metadata
  } as DIDResolutionResult;
}

export default {
  getResolver: (config: NftResovlerConfig): ResolverRegistry => {
    if (!config?.ceramic) {
      throw new Error('Invalid config for nft-did-resolver')
    } else if (config.subGraphUrls) {
      try {
        // ensure that any provided url is a valid url
        if (config.subGraphUrls.erc721) new URL(config.subGraphUrls.erc721);
        if (config.subGraphUrls.erc1155) new URL(config.subGraphUrls.erc1155);
      } catch (e) {
        throw new Error(`Invalid subGraphUrl in config for nft-did-resolver: ${e}`);
      }
    }
    return {
      nft: async (
        did: string, 
        parsed: ParsedDID, 
        resolver: Resolver, 
        options: DIDResolutionOptions
      ): Promise<DIDResolutionResult> => {
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
