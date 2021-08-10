import type {
  DIDResolutionResult,
  DIDResolutionOptions,
  DIDDocument,
  ParsedDID,
  Resolver,
  ResolverRegistry,
  VerificationMethod,
} from 'did-resolver'
import type { CeramicApi } from '@ceramicnetwork/common'
import { Caip10Link } from '@ceramicnetwork/stream-caip10-link'
import { ChainId, AccountId, AssetId } from 'caip'
import { DIDDocumentMetadata } from 'did-resolver'
import { blockAtTime, erc1155OwnersOf, erc721OwnerOf, isWithinLastBlock } from './subgraph-utils'
import merge from 'merge-options'

const DID_LD_JSON = 'application/did+ld+json'
const DID_JSON = 'application/did+json'

export function didToCaip(id: string): AssetId {
  const caip = id
    .replace(/^did:nft:/, '')
    .replace(/\?.+$/, '')
    .replace(/_/g, '/')
  return new AssetId(AssetId.parse(caip))
}

async function assetToAccount(
  asset: AssetId,
  timestamp: number | undefined,
  chains: Record<string, ChainConfig | undefined>
): Promise<AccountId[]> {
  const assetChainId = asset.chainId.toString()
  const chain = chains[assetChainId]
  if (!chain) {
    throw new Error(`No chain configuration for ${assetChainId}`)
  }

  // we want to query what block is at the timestamp IFF it is an (older) existing timestamp
  let queryBlock = 0
  if (timestamp && !isWithinLastBlock(timestamp, chain.skew)) {
    queryBlock = await blockAtTime(timestamp, chain.blocks)
  }

  let owners: string[]
  let ercSubgraphUrls = undefined

  if (chains && chains[assetChainId]) {
    ercSubgraphUrls = chains[assetChainId].assets
  }

  if (asset.assetName.namespace === 'erc721') {
    owners = [await erc721OwnerOf(asset, queryBlock, ercSubgraphUrls?.erc721)]
  } else if (asset.assetName.namespace === 'erc1155') {
    owners = await erc1155OwnersOf(asset, queryBlock, ercSubgraphUrls?.erc1155)
  } else {
    throw new Error(
      `Only erc721 and erc1155 namespaces are currently supported. Given: ${asset.assetName.namespace}`
    )
  }

  return owners.slice().map(
    (owner) =>
      new AccountId({
        chainId: asset.chainId,
        address: owner,
      })
  )
}

/**
 * Creates CAIP-10 links for each account to be used as controllers.
 * Since there may be many owners for a given NFT (only ERC1155 for now),
 * there can be many controllers of that DID document.
 */
async function accountsToDids(
  accounts: AccountId[],
  timestamp: number,
  ceramic: CeramicApi
): Promise<string[] | undefined> {
  const controllers: string[] = []

  const links = await Promise.all(
    accounts.map((accountId: AccountId) => Caip10Link.fromAccount(ceramic, accountId))
  )

  for (const link of links) {
    if (link?.did) controllers.push(link.did)
  }

  return controllers.length > 0 ? controllers : undefined
}

function wrapDocument(did: string, accounts: AccountId[], controllers?: string[]): DIDDocument {
  // Each of the owning accounts is a verification method (at the point in time)
  const verificationMethods = accounts.slice().map<VerificationMethod>((account) => {
    return {
      id: `${did}#${account.address}`,
      type: 'BlockchainVerificationMethod2021',
      controller: did,
      blockchainAccountId: account.toString(),
    }
  })

  const doc: DIDDocument = {
    id: did,
    verificationMethod: [...verificationMethods],
  }

  // Controllers should only be an array when there're more than one
  if (controllers) doc.controller = controllers.length === 1 ? controllers[0] : controllers

  return doc
}

/**
 * Gets the unix timestamp from the `versionTime` parameter.
 * @param query
 */
function getVersionTime(query = ''): number {
  const versionTime = query.split('&').find((e) => e.includes('versionTime'))
  if (versionTime) {
    return Math.floor(new Date(versionTime.split('=')[1]).getTime() / 1000)
  }
  return 0 // 0 is falsey
}

function validateResolverConfig(config: Partial<NftResolverConfig>) {
  if (!config) {
    throw new Error(`Missing nft-did-resolver config`)
  }
  if (!config.ceramic) {
    throw new Error('Missing ceramic client in nft-did-resolver config')
  }
  const chains = config.chains
  if (!chains) {
    throw new Error('Missing chain parameters in nft-did-resolver config')
  }
  try {
    Object.entries(config.chains).forEach(([chainId, chainConfig]) => {
      ChainId.parse(chainId)
      new URL(chainConfig.blocks)
      Object.values(chainConfig.assets).forEach((subgraph) => {
        new URL(subgraph)
      })
    })
  } catch (e) {
    throw new Error(`Invalid config for nft-did-resolver: ${e.message}`)
  }
}

export type ChainConfig = {
  blocks: string
  skew: number
  assets: Record<string, string>
}

/**
 * When passing in a custom subgraph url, it must conform to the same standards as
 * represented by the included ERC721 and ERC1155 subgraphs
 * Example:
 * ```
 * const customConfig = {
 *  ceramic: ceramicClient,
 *  chains: {
 *    "eip155:1": {
 *      "blocks": "https://api.thegraph.com/subgraphs/name/yyong1010/ethereumblocks",
 *      "skew": 15000, // in milliseconds
 *      "assets": {
 *        "erc1155": "https://api.thegraph.com/subgraphs/name/amxx/eip1155-subgraph",
 *        "erc721": "https://api.thegraph.com/subgraphs/name/touchain/erc721track",
 *      }
 *    }
 *  }
 * }
 * ```
 */
export type NftResolverConfig = {
  ceramic: CeramicApi
  chains: Record<string, ChainConfig>
}

async function resolve(
  did: string,
  methodId: string,
  timestamp: number,
  config: NftResolverConfig
): Promise<DIDResolutionResult> {
  const asset = didToCaip(methodId)
  // for 1155s, there can be many accounts that own a single asset
  const owningAccounts = await assetToAccount(asset, timestamp, config.chains)
  const controllers = await accountsToDids(owningAccounts, timestamp, config.ceramic)
  const metadata: DIDDocumentMetadata = {}

  // TODO create (if it stays in the spec)

  return {
    didResolutionMetadata: { contentType: DID_JSON },
    didDocument: wrapDocument(did, owningAccounts, controllers),
    didDocumentMetadata: metadata,
  }
}

/**
 * Convert AssetId to did:nft URL, including timestamp, if present.
 * @param assetId - NFT Asset
 * @param timestamp - JS Time as unix timestamp.
 */
export function caipToDid(assetId: AssetId, timestamp?: number): string {
  const query = timestamp
    ? `?versionTime=${new Date(timestamp * 1000).toISOString().split('.')[0] + 'Z'}`
    : ''

  const id = assetId.toString().replace(/\//g, '_')
  return `did:nft:${id}${query}`
}

function withDefaultConfig(config: Partial<NftResolverConfig>): NftResolverConfig {
  const defaults = {
    chains: {
      'eip155:1': {
        blocks: 'https://api.thegraph.com/subgraphs/name/yyong1010/ethereumblocks',
        skew: 15000,
        assets: {
          erc721: 'https://api.thegraph.com/subgraphs/name/sunguru98/mainnet-erc721-subgraph',
          erc1155: 'https://api.thegraph.com/subgraphs/name/sunguru98/mainnet-erc1155-subgraph',
        },
      },
      'eip155:4': {
        blocks: 'https://api.thegraph.com/subgraphs/name/mul53/rinkeby-blocks',
        skew: 15000,
        assets: {
          erc721: 'https://api.thegraph.com/subgraphs/name/sunguru98/erc721-rinkeby-subgraph',
          erc1155: 'https://api.thegraph.com/subgraphs/name/sunguru98/erc1155-rinkeby-subgraph',
        },
      },
      'eip155:137': {
        blocks: 'https://api.thegraph.com/subgraphs/name/matthewlilley/polygon-blocks',
        skew: 2200,
        assets: {
          erc721: 'https://api.thegraph.com/subgraphs/name/yellow-heart/maticsubgraph',
          erc1155: 'https://api.thegraph.com/subgraphs/name/tranchien2002/eip1155-matic',
        },
      },
    },
  }
  return merge.bind({ ignoreUndefined: true })(defaults, config)
}

export type NftDidUrlParams = {
  chainId: string
  namespace: string
  tokenId: string
  timestamp?: number
}

/**
 * Convert NFT asset id to NFT DID URL. Can include timestamp (as unix timestamp) if provided.
 */
export function createNftDidUrl(params: NftDidUrlParams): string {
  return caipToDid(
    new AssetId({
      chainId: params.chainId,
      assetName: params.namespace,
      tokenId: params.tokenId,
    }),
    params.timestamp
  )
}

export default {
  getResolver: (
    config: Partial<NftResolverConfig> & Required<{ ceramic: CeramicApi }>
  ): ResolverRegistry => {
    config = withDefaultConfig(config)
    validateResolverConfig(config)
    return {
      nft: async (
        did: string,
        parsed: ParsedDID,
        resolver: Resolver,
        options: DIDResolutionOptions
      ): Promise<DIDResolutionResult> => {
        console.log('res.0', did, parsed)
        const contentType = options.accept || DID_JSON
        try {
          const timestamp = getVersionTime(parsed.query)
          const didResult = await resolve(did, parsed.id, timestamp, config as NftResolverConfig)

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
              message: e.toString(),
            },
            didDocument: null,
            didDocumentMetadata: {},
          }
        }
      },
    }
  },
}
