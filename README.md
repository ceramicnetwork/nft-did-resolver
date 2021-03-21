# NFT DID Resolver

> NFT is a DID method that uses the Ceramic network to resolve DID documents for NFTs

## Getting started

This implementation is still a prototype. Contributions are welcome!

### Installation
```
$ npm install nft-did-resolver
```

### Usage

```js
import NftResolver from 'nft-did-resolver'
import { Resolver } from 'did-resolver'
import Ceramic from '@ceramicnetwork/http-client'

const ceramic = new Ceramic() // connects to localhost:7007 by default

const config = {
  ceramic,
  ethereumRpcs: {
    'eip155:1': 'http://localhost:8545' // url for a mainnet ethereum provider
  }
}

// getResolver will return an object with a key/value pair of { 'nft': resolver }
// where resolver is a function used by the generic did resolver.
const nftResolver = NftResolver.getResolver(config)
const didResolver = Resolver(nftResolver)

const result = await didResolver.resolve('did:nft:eip155.1_erc721.0xb300a43751601bd54ffee7de35929537b28e1488_2')
console.log(result)
```

## Development
Start a ceramic daemon using the `@ceramicnetwork/cli` package, and a ganache ethereum rpc using the `ganacle-cli` package.


Then run tests:
```
$ npm test
```


## Contributing
We are happy to accept small and large contributions. Make sure to check out the [Ceramic specifications](https://github.com/ceramicnetwork/specs) for details of how the protocol works.


## License
Apache-2.0 OR MIT
