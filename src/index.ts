import type {
  DIDResolutionResult,
  DIDResolutionOptions,
  DIDDocument,
  ParsedDID,
  Resolver,
  ResolverRegistry
} from 'did-resolver';
import type { CeramicApi } from '@ceramicnetwork/common';
import { ChainID, AccountID } from 'caip';
import fetch from 'cross-fetch';
import { jsonToGraphQLQuery } from 'json-to-graphql-query';


const ERC721_QUERY_URL = 'https://api.thegraph.com/subgraphs/name/wighawag/eip721-subgraph';
const ERC1155_QUERY_URL = 'https://api.thegraph.com/subgraphs/name/amxx/eip1155-subgraph';

const DID_LD_JSON = 'application/did+ld+json'
const DID_JSON = 'application/did+json'


const fetchQueryData = async (queryUrl: string, query: any): Promise<any> => {
  const fetchOpts = {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: jsonToGraphQLQuery({ query }) })
  };

  const resp = await fetch(queryUrl, fetchOpts);

  if (resp.ok) {
    const { data, error } = await resp.json();
    if (error) throw new Error(error.message);
    return data;
  } else {
    throw new Error('Not a valid NFT id')
  }
}


type ERC721DataResponse = {
  tokens: {
    owner: {
      id: string;
    }
  }[]
}

const erc721OwnerOf = async (asset: AssetID, customSubgraph?: string): Promise<string> => {
  const query = {
    tokens: {
      __args: {
        where: {
          // contract: asset.reference, // not necessary 
          id: [asset.reference, asset.tokenId].join('_')
        },
        first: 1
      },
      owner: {
        id: true
      }
    }
  };

  const queryData = await fetchQueryData(customSubgraph || ERC721_QUERY_URL, query) as ERC721DataResponse;

  if (!queryData?.tokens) {
    throw new Error('Missing data');
  } else if (queryData.tokens.length === 0) {
    throw new Error(`No owner found for contract: ${asset.reference} and ERC721 NFT id: ${asset.tokenId}`)
  }

  return queryData.tokens[0].owner.id;
}


type ERC1155DataResponse = {
  tokens: {
    balances: {
      account: {
        id: string;
      }
    }[]
  }[]
}

const erc1155OwnersOf = async (asset: AssetID, customSubgraph?: string): Promise<string[]> => {
  const query = {
    tokens: {
      __args: {
        where: {
          registry: asset.reference,
          identifier: asset.tokenId
          // id: [asset.reference, `0x${asset.tokenId}`].join('-') // could use this instead
        },
        first: 1
      },
      balances: {
        account: {
          id: true
        }
      }
    }
  };

  const queryData = await fetchQueryData(customSubgraph || ERC1155_QUERY_URL, query) as ERC1155DataResponse;

  if (!queryData?.tokens[0]) {
    throw new Error(`No tokens with ERC1155 NFT ID: ${asset.tokenId} found for contract: ${asset.reference}`);
  } else if (!queryData.tokens[0].balances || queryData.tokens[0].balances.length === 0) {
    throw new Error(`No owner found for ERC1155 NFT ID: ${asset.tokenId} for contract: ${asset.reference}`)
  }

  return queryData.tokens[0].balances.slice().map(bal => bal.account.id);
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

// TODO - should be part of the caip library
interface AssetID {
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

async function assetToAccount(asset: AssetID, timestamp: number, customSubgraph?: string): Promise<AccountID[]> {
  const owners = asset.namespace === 'erc721'
    ? [ await erc721OwnerOf(asset, customSubgraph) ] : await erc1155OwnersOf(asset, customSubgraph);

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

  const verificationMethods = accounts.slice().map(account => {
    return {
      id: did + '#owner',
      type: 'BlockchainVerificationMethod2021',
      controller: did,
      blockchainAccountId: account.toString()
    }
  });

  const doc: DIDDocument = {
    id: did,
    verificationMethod: [...verificationMethods]
  }
  if (controllers) doc.controller = controllers.length === 1 ? controllers[0] : controllers;
  
  return doc;
}

/**
 * When passing in a custom subgraph url, it must conform to the same standards as 
 * represented by the included ERC721 and ERC1155 subgraphs
 */
export interface NftResovlerConfig {
  ceramic: CeramicApi;
  customSubgraphUrl?: string;
}

async function resolve(
  did: string,
  methodId: string,
  timestamp: number,
  config: NftResovlerConfig
): Promise<DIDResolutionResult> {
  const asset = idToAsset(methodId);
  // for 1155s, there can be many accounts that own a single asset
  const owningAccounts = await assetToAccount(asset, timestamp, config.customSubgraphUrl);
  const controllers = await accountsToDids(owningAccounts, timestamp, config.ceramic);
  return {
    didResolutionMetadata: { contentType: DID_JSON },
    didDocument: wrapDocument(did, owningAccounts, controllers),
    didDocumentMetadata: {}
  }
}

export default {
  getResolver: (config: NftResovlerConfig): ResolverRegistry => {
    if (!config?.ceramic) {
      throw new Error('Invalid config for nft-did-resolver')
    } else if (config && config.customSubgraphUrl) {
      try {
        new URL(config.customSubgraphUrl);
      } catch (e) {
        throw new Error('Invalid customSubgraphUrl in config for nft-did-resolver');
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
