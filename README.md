# NFT DID Resolver

> NFT is a DID method that uses the Ceramic network to resolve DID documents for NFTs

> See [CIP-94](https://github.com/ceramicnetwork/CIP/blob/main/CIPs/CIP-94/CIP-94.md)

## Getting started

This implementation is still a prototype. Contributions are welcome!

By default, this package will resolve dids for both ERC721 and ERC1155 tokens on mainnet, if they are indexed by their respective public subgraphs: 
* [EIP721-Subgraph](https://api.thegraph.com/subgraphs/name/wighawag/eip721-subgraph)
* [EIP1155-Subgraph](https://api.thegraph.com/subgraphs/name/amxx/eip1155-subgraph)

To resolve DIDs using your own subgraph, see [Custom Subgraphs](#custom-subgraphs)

### Installation
```
$ npm install nft-did-resolver
// or
$ yarn add nft-did-resolver
```

### Usage

```js
import NftResolver, { NftResovlerConfig } from 'nft-did-resolver'
import { Resolver } from 'did-resolver'
import Ceramic from '@ceramicnetwork/http-client'

const ceramic = new Ceramic() // connects to localhost:7007 by default

const config: NftResovlerConfig = {
  ceramic,
  subGraphUrls: { // optional, there are defaults for ethereum mainnet (erc721 and erc1155)
    // CAIP2 ChainID (below is ETH mainnet)
    'eip155:1': {
      // Asset namespace
      erc721: 'https://api.thegraph.com/subgraphs/name/xxx/yyy',
      // erc721: 'http://localhost:8000/subgraphs/name/aoeu/qjkx' // also works!
      erc1155: 'https://api.thegraph.com/subgraphs/name/abc/xyz'
    },
    // Fake cosmos example
    'cosmos:nft-token-chainid': {
      erc721: 'https://api.thegraph.com/subgraphs/name/aaa/ooo'
    }
  }
}

// getResolver will return an object with a key/value pair of { 'nft': resolver }
// where resolver is a function used by the generic did resolver.
const nftResolver = NftResolver.getResolver(config)
const didResolver = Resolver(nftResolver)

const erc721result = await didResolver.resolve('did:nft:eip155.1_erc721.0xb300a43751601bd54ffee7de35929537b28e1488_2')
const erc1155result = await didResolver.resolve('did:nft:eip155.1_erc1155.0x06eb48572a2ef9a3b230d69ca731330793b65bdc_1')
console.log(erc721result, erc1155result)
```

## Development
Start a ceramic daemon using the `@ceramicnetwork/cli` package, and a ganache ethereum rpc using the `ganacle-cli` package.


Then run tests:
```
$ npm test
$ yarn test
```

## Custom Subgraphs
You may specify custom subgraph URLs in the configuration object as shown above in [usage](#usage).

**Note**: custom subgraphs must conform to the below schemas at a *minimum* for assets to be resolved properly.

**Note**: At the moment, only ERC721 and ERC1155 asset namespaces are supported. However, CAIP2 chains beside ETH,
for instance xDAI, with support for those namespaces *are* supported, as long as the subgraph schema is the same.

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

**ERC721** ([CAIP-22](https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/CAIP-22.md))

DID: `did:nft:{chainNamespace}.{chainReference}_erc721.{contractAddress}_{tokenId}`

CAIP-22: `{chainNamespace}:{chainReference}/erc721:{contractAddress}/{tokenId}`

**ERC1155** ([CAIP-29](https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/CAIP-29.md))

DID: `did:nft:{chainNamespace}.{chainReference}_erc1155.{contractAddress}_{tokenId}`

CAIP-29: `{chainNamespace}:{chainReference}/erc1155:{contractAddress}/{tokenId}`


### Conversions
**DID->CAIP**
```
const caip = did.substr(8).replace(/_/g, '/').replace(/\./g, ':')
```
**CAIP->DID**
```
const did = `did:nft:${caip.replace(/\//g, '_').replace(/:/g, '.')}`
```


## Contributing
We are happy to accept small and large contributions. Make sure to check out the [Ceramic specifications](https://github.com/ceramicnetwork/specs) for details of how the protocol works.


## License
Apache-2.0 OR MIT
