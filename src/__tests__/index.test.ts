import NftResolver, { NftResovlerConfig } from '..';
import { Resolver, ResolverRegistry } from 'did-resolver';
import Ceramic from '@ceramicnetwork/http-client';
import { EthereumAuthProvider } from '@ceramicnetwork/blockchain-utils-linking';
import * as u8a from 'uint8arrays';
import fetchMock from "jest-fetch-mock";
import { ethers } from 'ethers'

const ERC721_QUERY_URL = 'https://api.thegraph.com/subgraphs/name/wighawag/eip721-subgraph';
const ERC1155_QUERY_URL = 'https://api.thegraph.com/subgraphs/name/amxx/eip1155-subgraph';

const erc721Contract = '0x7e789e2dd1340971de0a9bca35b14ac0939aa330';
const erc721Owner = '0x431cf61e7aff8e68142f6263e9fadde40aff8c7d';
const erc721OwnerResponse = { data: { tokens: [ { owner: { id: erc721Owner } } ] } };
const erc721NoResponse = { data: { tokens: [ ] } };

const erc1155Contract = '0x06eb48572a2ef9a3b230d69ca731330793b65bdc';
const erc1155Owners = [ '0xef1bd3fc679a6f0cd296b59aff99ddc21409869f', '0x5bb822302e78c978f3d73cd7565ad92240779cae', '0xa84de981f6f6d2d78e8d59239db73c89f058cb58' ];
const erc1155Accounts = erc1155Owners.map(owner => { return { account: { id: owner } } } );
const erc1155OwnersResponse = { data: { tokens: [ { balances: erc1155Accounts } ] } };
const erc1155NoResponse = { data: { tokens: [ { balances: [ ] } ] } };

const caipLinkControllerDid = 'did:3:testing';


describe('NFT DID Resolver (TheGraph)', () => {
  const mainChainId = 'eip155:1';

  let config: NftResovlerConfig;
  let nftResolver: ResolverRegistry;
  let resolver: Resolver;

  let ethAccount: string;
  let ethAuthProv: EthereumAuthProvider;


  beforeAll(async () => {
    config = {
      ceramic: new Ceramic(),
    }

    nftResolver = NftResolver.getResolver(config);
    resolver = new Resolver(nftResolver);

    
    // Set up the EthAuthProvider
    const ethRpcProvider = new ethers.providers.JsonRpcProvider('http://localhost:8545')
    const ethSigner = ethRpcProvider.getSigner(1);
    ethAccount = (await ethSigner.getAddress()).toLowerCase()

    ethAuthProv = createEthAuthProvider(ethSigner, ethAccount);
    await createCaip10Link(ethAuthProv, config.ceramic);
  });

  it('getResolver works correctly', () => {
    expect(Object.keys(nftResolver)).toEqual(['nft']);
  });

  it('throws when customSubgraphUrl is not a url', () => {
    const customConfig = { ...config };
    customConfig.customSubgraphUrl = 'yikes';
    expect(() => NftResolver.getResolver(customConfig))
      .toThrowError('Invalid customSubgraphUrl in config for nft-did-resolver');
  })


  describe('ERC721 NFTs', () => {

    beforeEach(() => {
      fetchMock.resetMocks();
      fetchMock.mockIf(ERC721_QUERY_URL);
    });

    it('resolves an erc721 nft document without caip10-link', async () => {
      fetchMock.once(JSON.stringify(erc721OwnerResponse));

      const tokenId = '1';
      const erc721Did = make721DID(mainChainId, erc721Contract, tokenId);

      expect(await resolver.resolve(erc721Did)).toEqual({
        didDocument: {
          id: erc721Did,
          verificationMethod: [{
            id: `${erc721Did}#owner`,
            type: 'BlockchainVerificationMethod2021',
            controller: erc721Did,
            blockchainAccountId: `${erc721Owner}@eip155:1`
          }]
        },
        didDocumentMetadata: {},
        didResolutionMetadata: { contentType: 'application/did+json' }
      });
    });

    it('resolves an erc721 nft document with caip10-link', async () => {
      fetchMock.once(JSON.stringify(erc721OwnerResponse).replace(erc721Owner, ethAccount));


      const tokenId = '2';
      const erc721Did = make721DID(mainChainId, erc721Contract, tokenId);

      expect(await resolver.resolve(erc721Did)).toEqual({
        didDocument: {
          id: erc721Did,
          controller: caipLinkControllerDid,
          verificationMethod: [{
            blockchainAccountId: `${ethAccount}@eip155:1`,
            controller: erc721Did,
            id: `${erc721Did}#owner`,
            type: 'BlockchainVerificationMethod2021'
          }]
        },
        didDocumentMetadata: {},
        didResolutionMetadata: { contentType: 'application/did+json' }
      })
    })

    it('throws on invalid ERC721 contract', async () => {
      fetchMock.once(JSON.stringify(erc721NoResponse));
      const invalidContract = '0x1234567891234567891234567891234596351156';
      const tokenId = 1;
      const erc721Did = make721DID(mainChainId, invalidContract, tokenId);
      expect(await resolver.resolve(erc721Did)).toEqual({
        didDocument: null,
        didDocumentMetadata: {},
        didResolutionMetadata: {
          error: "invalidDid",
          message: `Error: No owner found for contract: ${invalidContract} and ERC721 NFT id: ${tokenId}`
        }
      });
    });

    it('throws on non-existent ERC721 token with valid contract', async () => {
      fetchMock.once(JSON.stringify(erc721NoResponse));
      const tokenId = 12345678910;
      const erc721Did = make721DID(mainChainId, erc721Contract, tokenId);
      expect(await resolver.resolve(erc721Did)).toEqual({
        didDocument: null,
        didDocumentMetadata: {},
        didResolutionMetadata: {
          error: "invalidDid",
          message: `Error: No owner found for contract: ${erc721Contract} and ERC721 NFT id: ${tokenId}`
        }
      });
    });
  });

  
  describe('ERC1155 NFTs', () => {

    beforeEach(() => {
      fetchMock.resetMocks();
      fetchMock.mockIf(ERC1155_QUERY_URL);
    });

    it('resolves an erc1155 nft document without caip10-link', async () => {
      fetchMock.once(JSON.stringify(erc1155OwnersResponse));
      const tokenId = '1';
      const erc1155Did = make1155DID(mainChainId, erc1155Contract, tokenId);

      const expectedVerifications = erc1155Owners.map(owner => {
        return {
          id: `${erc1155Did}#owner`,
          type: 'BlockchainVerificationMethod2021',
          controller: erc1155Did,
          blockchainAccountId: `${owner}@eip155:1`
        }
      });
      
      expect(await resolver.resolve(erc1155Did)).toEqual({
        didDocument: {
          id: erc1155Did,
          verificationMethod: expectedVerifications
        },
        didDocumentMetadata: {},
        didResolutionMetadata: { contentType: 'application/did+json' }
      });
    });

    it('resolves an erc1155 nft document with caip10-link', async () => {
      fetchMock.once(JSON.stringify(erc1155OwnersResponse).replace(erc1155Owners[0], ethAccount));

      const tokenId = '1';
      const erc1155Did = make1155DID(mainChainId, erc1155Contract, tokenId);

      const newOwners = erc1155Owners;
      newOwners.splice(0, 1, ethAccount);

      const expectedVerifications = newOwners.slice().map(owner => {
        return {
          id: `${erc1155Did}#owner`,
          type: 'BlockchainVerificationMethod2021',
          controller: erc1155Did,
          blockchainAccountId: `${owner}@eip155:1`
        }
      });

      expect(await resolver.resolve(erc1155Did)).toEqual({
        didDocument: {
          id: erc1155Did,
          controller: caipLinkControllerDid,
          verificationMethod: expectedVerifications
        },
        didDocumentMetadata: {},
        didResolutionMetadata: { contentType: 'application/did+json' }
      })
    })

    it('throws on invalid ERC1155 contract', async () => {
      fetchMock.once(JSON.stringify(erc1155NoResponse));
      const invalidContract = '0x9876543219876543219876543219876543219876';
      const tokenId = 1;
      const erc1155Did = make1155DID(mainChainId, invalidContract, tokenId);

      expect(await resolver.resolve(erc1155Did)).toEqual({
        didDocument: null,
        didDocumentMetadata: {},
        didResolutionMetadata: {
          error: "invalidDid",
          message: `Error: No owner found for ERC1155 NFT ID: ${tokenId} for contract: ${invalidContract}`
        }
      });
    });

    it('throws on non-existent ERC1155 token with valid contract', async () => {
      fetchMock.once(JSON.stringify(erc1155NoResponse));
      const badTokenId = 12345678910;
      const erc1155Did = make1155DID(mainChainId, erc1155Contract, badTokenId);

      expect(await resolver.resolve(erc1155Did)).toEqual({
        didDocument: null,
        didDocumentMetadata: {},
        didResolutionMetadata: {
          error: "invalidDid",
          message: `Error: No owner found for ERC1155 NFT ID: ${badTokenId} for contract: ${erc1155Contract}`
        }
      });
    });
  });
});

const make721DID = (chainid, contract, tokenId) => {
  const caip19 = chainid + '_erc721.' + contract + '_' + tokenId;
  return 'did:nft:' + (caip19.replace(':', '.'));
}

const make1155DID = (chainid, contract, tokenId) => {
  const caip29 = chainid + '_erc1155.' + contract + '_' + tokenId;
  return 'did:nft:' + (caip29.replace(':', '.'));
}


async function createCaip10Link(ethAuthProv: EthereumAuthProvider, ceramic: Ceramic) {
  const proof = await ethAuthProv.createLink(caipLinkControllerDid);
  const doc = await ceramic.createDocument('caip10-link', {
    metadata: { family: 'caip10-link', controllers: [proof.account] }
  });
  await doc.change({ content: proof });
}

function createEthAuthProvider(ethSigner: ethers.providers.JsonRpcSigner, ethAccount: string) {
  return new EthereumAuthProvider({
    send: async (data, cb) => {
      if (data.method === 'eth_chainId') {
        cb(null, { result: '0x1' });
      } else if (data.method === 'eth_getCode') {
        cb(null, { result: '0x' });
      } else {
        // it's personal_sign
        const msg = u8a.toString(u8a.fromString(data.params[0].slice(2), 'base16'));
        const sign = await ethSigner.signMessage(msg);
        cb(null, { result: sign });
      }
    }
  }, ethAccount);
}

