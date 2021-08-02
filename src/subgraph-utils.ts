import fetch from 'cross-fetch'
import { jsonToGraphQLQuery } from 'json-to-graphql-query'
import { AssetID } from '.'

const GRAPH_API_PREFIX = 'https://api.thegraph.com/subgraphs/name'
const BLOCK_QUERY_URL = `${GRAPH_API_PREFIX}/yyong1010/ethereumblocks`
const ERC721_QUERY_URL = `${GRAPH_API_PREFIX}/touchain/erc721track`
const ERC1155_QUERY_URL = `${GRAPH_API_PREFIX}/amxx/eip1155-subgraph`

export const fetchQueryData = async (queryUrl: string, query: unknown): Promise<any> => {
  const fetchOpts = {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: jsonToGraphQLQuery({ query }) }),
  }

  const resp = await fetch(queryUrl, fetchOpts)

  if (resp.ok) {
    const { data, error } = await resp.json()
    if (error) throw new Error(error.message)
    return data
  } else {
    throw new Error('Received an invalid response from TheGraph API')
  }
}

type BlockQueryResponse = {
  blocks: {
    number: string
  }[]
}

/**
 * Queries TheGraph to find the latest block at the given time.
 * @param timestamp
 * @returns {string} latest block num at timestamp
 */
export const blockAtTime = async (timestamp: number): Promise<number> => {
  const query = {
    blocks: {
      __args: {
        first: 1,
        orderBy: 'timestamp',
        orderDirection: 'desc',
        where: {
          // we ask for lte because it is the last known block at the given time
          timestamp_lte: timestamp,
        },
      },
      number: true,
    },
  }

  const queryData = (await fetchQueryData(BLOCK_QUERY_URL, query)) as BlockQueryResponse

  if (!queryData?.blocks) {
    throw new Error('Missing data from subgraph query')
  } else if (queryData.blocks.length === 0) {
    throw new Error(`No blocks exist before timestamp: ${timestamp}`)
  }

  return parseInt(queryData.blocks[0].number)
}
/**
 * Eth blocks are typically 13 seconds. We use this check so we don't have to
 * make an unneccessary call to the blocks subgraph if the did was just created.
 */
export const isWithinLastBlock = (timestamp: number): boolean => {
  return Date.now() - timestamp <= 10 * 1000
}

type ERC721DataResponse = {
  tokens: {
    owner: {
      id: string
    }
  }[]
}

export const erc721OwnerOf = async (
  asset: AssetID,
  blockNum: number,
  customSubgraph?: string
): Promise<string> => {
  const query = {
    tokens: {
      __args: {
        where: {
          // contract: asset.reference, // not necessary
          id: [asset.reference, asset.tokenId].join('-'),
        },
        first: 1,
        block: blockNum ? { number: blockNum } : null,
      },
      owner: {
        id: true,
      },
    },
  }

  const queryUrl = customSubgraph || ERC721_QUERY_URL
  const queryData = (await fetchQueryData(queryUrl, query)) as ERC721DataResponse

  if (!queryData?.tokens) {
    throw new Error('Missing data from subgraph query')
  } else if (queryData.tokens.length === 0) {
    throw new Error(
      `No owner found for ERC721 NFT ID: ${asset.tokenId} for contract: ${asset.reference}`
    )
  }

  return queryData.tokens[0].owner.id
}

type ERC1155DataResponse = {
  tokens: {
    balances: {
      account: {
        id: string
      }
    }[]
  }[]
}

export const erc1155OwnersOf = async (
  asset: AssetID,
  blockNum: number,
  customSubgraph?: string
): Promise<string[]> => {
  const query = {
    tokens: {
      __args: {
        where: {
          registry: asset.reference,
          identifier: asset.tokenId,
          // id: [asset.reference, `0x${asset.tokenId}`].join('-') // could use this instead
        },
        first: 1,
        block: blockNum ? { number: blockNum } : null,
      },
      balances: {
        __args: {
          where: {
            value_gt: 0, // we don't want to get an "owner" with a balance of zero
          },
        },
        account: {
          id: true,
        },
      },
    },
  }

  const queryUrl = customSubgraph || ERC1155_QUERY_URL
  const queryData = (await fetchQueryData(queryUrl, query)) as ERC1155DataResponse

  if (!queryData?.tokens[0]) {
    throw new Error(
      `No tokens with ERC1155 NFT ID: ${asset.tokenId} found for contract: ${asset.reference}`
    )
  } else if (!queryData.tokens[0].balances || queryData.tokens[0].balances.length === 0) {
    throw new Error(
      `No owner found for ERC1155 NFT ID: ${asset.tokenId} for contract: ${asset.reference}`
    )
  }

  return queryData.tokens[0].balances.slice().map((bal) => bal.account.id)
}
