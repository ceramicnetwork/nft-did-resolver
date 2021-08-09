import { DIDResolutionResult, VerificationMethod } from 'did-resolver'

export class NftDidVector {
  nftDid: string
  nftOwners: string[] | undefined
  verificationMethods: VerificationMethod[] | undefined
  versionId: string | undefined
  versionTime: string | undefined
  caip10Controller: string | undefined
  errorMessage: string | undefined

  constructor(vectorBuilder: NftDidVectorBuilder) {
    this.nftDid = vectorBuilder.nftDid
    this.nftOwners = vectorBuilder.nftOwners
    this.verificationMethods = vectorBuilder.verificationMethods
    this.versionId = vectorBuilder.versionId
    this.versionTime = vectorBuilder.versionTime
    this.caip10Controller = vectorBuilder.caip10Controller
    this.errorMessage = vectorBuilder.errorMessage
  }

  getDidWithVersionId(): string {
    return this.nftDid.concat(`?versionId=${this.versionId}`)
  }

  getDidWithVersionTime(): string {
    return this.nftDid.concat(`?versionTime=${this.versionTime}`)
  }

  getResult(): DIDResolutionResult {
    if (this.errorMessage) {
      return {
        didDocument: null,
        didDocumentMetadata: {},
        didResolutionMetadata: {
          error: 'invalidDid',
          message: this.errorMessage,
        },
      }
    }

    const resolutionResult = {
      didDocument: {
        id: this.nftDid,
      },
      didDocumentMetadata: {},
      didResolutionMetadata: { contentType: 'application/did+json' },
    } as DIDResolutionResult

    if (this.verificationMethods)
      resolutionResult.didDocument.verificationMethod = [...this.verificationMethods]
    if (this.caip10Controller) resolutionResult.didDocument.controller = this.caip10Controller
    return resolutionResult
  }
}

export class NftDidVectorBuilder {
  public readonly nftNamespace: string
  public readonly caip2ChainId: string

  public nftDid = '' // falsey, will throw if not made or provided
  public nftContract: string | undefined
  public nftId: string | undefined
  public nftOwners: string[] | undefined

  public verificationMethods: VerificationMethod[] | undefined
  public versionId: string | undefined
  public versionTime: string | undefined
  public caip10Controller: string | undefined

  public errorMessage: string | undefined

  constructor(caip2ChainId: string, nftNamespace: string) {
    this.caip2ChainId = caip2ChainId
    this.nftNamespace = nftNamespace
  }

  setNftContract(nftContract: string): NftDidVectorBuilder {
    this.nftContract = nftContract
    return this
  }

  setNftId(nftId: string): NftDidVectorBuilder {
    this.nftId = nftId.startsWith('0x') ? nftId : `0x${Number(nftId).toString(16)}`
    return this
  }

  setNftOwners(nftOwners: string[]): NftDidVectorBuilder {
    this.nftOwners = nftOwners
    return this
  }

  setNftDid(nftDid: string): NftDidVectorBuilder {
    this.nftDid = nftDid
    return this
  }

  setVerificationMethods(methods: VerificationMethod[]): NftDidVectorBuilder {
    this.verificationMethods = methods
    return this
  }

  setCaip10Controller(caip10Controller: string): NftDidVectorBuilder {
    this.caip10Controller = caip10Controller
    return this
  }

  setErrorMessage(errorMessage: string): NftDidVectorBuilder {
    this.errorMessage = errorMessage
    return this
  }

  setVersionId(versionId: string): NftDidVectorBuilder {
    this.versionId = versionId
    return this
  }

  // Should be ISOString
  setVersionTime(versionTime: string): NftDidVectorBuilder {
    this.versionTime = versionTime
    return this
  }

  build(): NftDidVector {
    if (!this.nftDid) this.nftDid = this.makeDid()

    if (!this.errorMessage && !this.verificationMethods)
      this.verificationMethods = this.makeVerificationMethods()

    return new NftDidVector(this)
  }

  private makeDid(): string {
    if (!this.nftContract || !this.nftId) {
      throw new Error('Must provide contract address and id OR DID.')
    }
    // caip2 uses a colon, while the did uses a period
    const chainId = this.caip2ChainId.replace(':', '.')
    return `did:nft:${chainId}_${this.nftNamespace}.${this.nftContract}_${this.nftId}`
  }

  private makeVerificationMethods(): VerificationMethod[] {
    if (!this.nftOwners) {
      throw new Error('Must provide NftOwners')
    } else if (!this.nftDid) {
      throw new Error('Must provide Nft DID or args')
    }

    return this.nftOwners.slice().map((owner) => {
      return {
        id: `${this.nftDid}#${owner}`,
        type: 'BlockchainVerificationMethod2021',
        controller: this.nftDid,
        blockchainAccountId: `${this.caip2ChainId}:${owner}`,
      } as VerificationMethod
    })
  }
}
