# NFT DID Resolver

> NFT is a DID method that uses the Ceramic network to resolve DID documents for NFTs

> See [CIP-94](https://github.com/ceramicnetwork/CIP/blob/main/CIPs/CIP-94/CIP-94.md)

## Getting started

This implementation is still a prototype. Contributions are welcome!

To use a package, you would need to provide three subgraph endpoints for every network you are going to use:
one for blocks, one for ERC721 tokens, another for ERC1155 tokens. You would also need to provide a `skew` that
is a time (in milliseconds) within which a latest block is considered valid. Usually it is a typical block time.

### Installation

```
$ npm install nft-did-resolver
```

### Usage

```typescript
import { getResolver } from 'nft-did-resolver'
import type { NftResolverConfig } from 'nft-did-resolver'
import { Resolver } from 'did-resolver'
import Ceramic from '@ceramicnetwork/http-client'

const ceramic = new Ceramic() // connects to localhost:7007 by default

const config: NftResolverConfig = {
  ceramic,
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
  },
}

// getResolver will return an object with a key/value pair of { 'nft': resolver }
// where resolver is a function used by the generic did resolver.
const nftResolver = getResolver(config)
const didResolver = Resolver(nftResolver)

const erc721result = await didResolver.resolve(
  'did:nft:eip155:1_erc721:0xb300a43751601bd54ffee7de35929537b28e1488_2'
)
const erc1155result = await didResolver.resolve(
  'did:nft:eip155:1_erc1155:0x06eb48572a2ef9a3b230d69ca731330793b65bdc_1'
)
console.log(erc721result, erc1155result)
```

`chains` field in config has [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-2.md) chain identifiers as keys.
Each such `chain` is expected to contain endpoints to ERC721 and/or ERC1155 subgraphs under `assets` field.
Both ERC721 and ERC1155 are supported. Feel free to specify either one or both.

The resolver supports the following networks by default:

- Ethereum mainnet (`eip155:1`),
- Ethereum Rinkeby (`eip155:4`),
- Polygon (formerly Matic) (`eip155:137`).

If you use one of those, you do not have to provide `chains` field.

## Testing

```
$ npm test
```

## Custom Subgraphs

You may specify custom subgraph URLs in the configuration object as shown above in [usage](#usage).

**Note**: custom subgraphs must conform to the below schemas at a _minimum_ for assets to be resolved properly.

**Note**: At the moment, only ERC721 and ERC1155 asset namespaces are supported. However, CAIP2 chains beside ETH,
for instance xDAI, with support for those namespaces _are_ supported, as long as the subgraph schema is the same.

### ERC721:

```gql
type Token @entity {
  id: ID!
  contract: TokenContract!
  owner: Owner!
  ...
}

type TokenContract @entity {
  id: ID!
  tokens: [Token!]! @derivedFrom(field: "contract")
  ...
}

type Owner @entity {
  id: ID!
  tokens: [Token!]! @derivedFrom(field: "owner")
  ...
}

```

### ERC1155:

```gql
type Account @entity {
  id: ID!
  balances: [Balance!]! @derivedFrom(field: "account")
  ...
}

type TokenRegistry @entity {
  id: ID!
  tokens: [Token!]! @derivedFrom(field: "registry")
  ...
}

type Token @entity {
  id: ID!
  registry: TokenRegistry!
  identifier: BigInt!
  balances: [Balance!]! @derivedFrom(field: "token")
  ...
}

type Balance @entity {
  id: ID!
  token: Token!
  account: Account!
  ...
}

```

For more information on writing schemas for GraphProtocol, check out [their documentation](https://thegraph.com/docs/define-a-subgraph#defining-entities).

## DID Specs

The token DIDs are prefixed with `did:nft:`, and the latter half is a modified CAIP format.

**ERC721** ([CAIP-22](https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-22.md))

DID: `did:nft:{chainNamespace}:{chainReference}_erc721:{contractAddress}_{tokenId}`

CAIP-22: `{chainNamespace}:{chainReference}/erc721:{contractAddress}/{tokenId}`

**ERC1155** ([CAIP-29](https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-29.md))

DID: `did:nft:{chainNamespace}:{chainReference}_erc1155:{contractAddress}_{tokenId}`

CAIP-29: `{chainNamespace}:{chainReference}/erc1155:{contractAddress}/{tokenId}`

### Conversions

**DID->CAIP**

```
const caip = did.substr(8).replace(/_/g, '/')
```

**CAIP->DID**

```
const did = `did:nft:${caip.replace(/\//g, '_')
```

There are helpers that help you with the conversion:

```typescript
import { caipToDid, didToCaip, createNftDidUrl } from 'nft-did-resolver'
import { AssetId } from 'caip'

// CAIP -> DID URL
const didUrl = createNftDidUrl({
  chainId: 'eip155:1',
  namespace: 'erc721',
  contract: '0x1234567891234567891234567891234596351156'
  tokenId: '1',
})
// If you use `caip` library in your app, consider using sister `caipToDid` function to convert `AssetId` to NFT DID URL.

// DID URL -> CAIP
const assetId1 = didToCaip(didUrl) // eip155:1/erc721:0x1234567891234567891234567891234596351156/1
const assetId2 = didToCaip(didUrlWithTimestamp) // eip155:1/erc721:0x1234567891234567891234567891234596351156/1
```

## Contributing

We are happy to accept small and large contributions. Make sure to check out the [Ceramic specifications](https://github.com/ceramicnetwork/specs) for details of how the protocol works.

## License

Apache-2.0 OR MIT
