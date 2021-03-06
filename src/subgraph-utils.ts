import fetch from 'cross-fetch'
import { jsonToGraphQLQuery } from 'json-to-graphql-query'
import { AssetId } from 'caip'
import BigNumber from 'bignumber.js'

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
 * @param blockQueryUrl - subgraph url for blocks
 * @returns {string} latest block num at timestamp
 */
export const blockAtTime = async (timestamp: number, blockQueryUrl: string): Promise<number> => {
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

  const queryData = (await fetchQueryData(blockQueryUrl, query)) as BlockQueryResponse

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
export const isWithinLastBlock = (timestamp: number, skew: number): boolean => {
  return Date.now() - timestamp <= skew
}

type ERC721DataResponse = {
  tokens: {
    owner: {
      id: string
    }
  }[]
}

export const erc721OwnerOf = async (
  asset: AssetId,
  blockNum: number,
  queryUrl: string
): Promise<string> => {
  const tokenId = `0x${new BigNumber(asset.tokenId).toString(16)}`
  const query = {
    tokens: {
      __args: {
        where: {
          id: [asset.assetName.reference, tokenId].join('-'),
        },
        first: 1,
        block: blockNum ? { number: blockNum } : null,
      },
      owner: {
        id: true,
      },
    },
  }

  const queryData = (await fetchQueryData(queryUrl, query)) as ERC721DataResponse

  if (!queryData?.tokens) {
    throw new Error('Missing data from subgraph query')
  } else if (queryData.tokens.length === 0) {
    throw new Error(
      `No owner found for ERC721 NFT ID: ${asset.tokenId} for contract: ${asset.assetName.reference}`
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
  asset: AssetId,
  blockNum: number,
  queryUrl: string
): Promise<string[]> => {
  const tokenId = `0x${new BigNumber(asset.tokenId).toString(16)}`
  const query = {
    tokens: {
      __args: {
        where: {
          id: [asset.assetName.reference, tokenId].join('-'),
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

  const queryData = (await fetchQueryData(queryUrl, query)) as ERC1155DataResponse

  if (!queryData?.tokens[0]) {
    throw new Error(
      `No tokens with ERC1155 NFT ID: ${asset.tokenId} found for contract: ${asset.assetName.reference}`
    )
  } else if (!queryData.tokens[0].balances || queryData.tokens[0].balances.length === 0) {
    throw new Error(
      `No owner found for ERC1155 NFT ID: ${asset.tokenId} for contract: ${asset.assetName.reference}`
    )
  }

  return queryData.tokens[0].balances.slice().map((bal) => bal.account.id)
}
