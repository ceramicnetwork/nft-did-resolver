import { DIDResolutionResult, VerificationMethod } from "did-resolver";
import { ErcNamespace } from "..";

export class NftDidVector {
  nftDid: string;
  nftOwners: string[];
  verificationMethods: VerificationMethod[];
  versionId: string | undefined;
  versionTime: string | undefined;
  caip10Controller: string | undefined;
  errorMessage: string | undefined;

  constructor(vectorBuilder: NftDidVectorBuilder) {
    this.nftDid = vectorBuilder.nftDid;
    this.nftOwners = vectorBuilder.nftOwners;
    this.verificationMethods = vectorBuilder.verificationMethods;
    this.versionId = vectorBuilder.versionId;
    this.versionTime = vectorBuilder.versionTime;
    this.caip10Controller = vectorBuilder.caip10Controller;
    this.errorMessage = vectorBuilder.errorMessage;
  }

  getDidWithVersionId(): string {
    return this.nftDid.concat(`?versionId=${this.versionId}`);
  }

  getDidWithVersionTime(): string {
    return this.nftDid.concat(`?versionTime=${this.versionTime}`);
  }

  getResult(): DIDResolutionResult {

    if (this.errorMessage) {
      const resolutionResult = {
        didDocument: null,
        didDocumentMetadata: {},
        didResolutionMetadata: { 
          error: "invalidDid",
          message: this.errorMessage
        }
      } as DIDResolutionResult;

      return resolutionResult;
    }

    const resolutionResult = {
      didDocument: {
        id: this.nftDid,
        verificationMethod: [...this.verificationMethods]
      },
      didDocumentMetadata: {},
      didResolutionMetadata: { contentType: 'application/did+json' }
    } as DIDResolutionResult;

    if (this.versionId) resolutionResult.didDocumentMetadata.versionId = this.versionId;
    if (this.versionTime) resolutionResult.didDocumentMetadata.versionTime = this.versionTime;
    if (this.caip10Controller) resolutionResult.didDocument.controller = this.caip10Controller;
    return resolutionResult;
  }
}

export class NftDidVectorBuilder {
  
  public readonly nftNamespace: ErcNamespace;

  public nftContract: string;
  public nftId: string;
  public nftDid: string;
  public nftOwners: string[];

  public verificationMethods: VerificationMethod[];
  public versionId: string | undefined;
  public versionTime: string | undefined;
  public caip10Controller: string | undefined;

  public errorMessage: string | undefined;

  constructor(nftNamespace: ErcNamespace) {
    this.nftNamespace = nftNamespace;
  }

  setNftContract(nftContract: string): NftDidVectorBuilder {
    this.nftContract = nftContract;
    return this;
  }

  setNftId(nftId: string): NftDidVectorBuilder {
    this.nftId = nftId;
    return this;
  }

  setNftOwners(nftOwners: string[]): NftDidVectorBuilder {
    this.nftOwners = nftOwners;
    return this;
  }

  setNftDid(nftDid: string): NftDidVectorBuilder {
    this.nftDid = nftDid;
    return this;
  }
  
  setVerificationMethods(methods: VerificationMethod[]): NftDidVectorBuilder {
    this.verificationMethods = methods;
    return this;
  }

  setCaip10Controller(caip10Controller: string): NftDidVectorBuilder {
    this.caip10Controller = caip10Controller;
    return this;
  }

  setErrorMessage(errorMessage: string): NftDidVectorBuilder {
    this.errorMessage = errorMessage;
    return this;
  }

  withVerificationMethods(): NftDidVectorBuilder {
    this.verificationMethods = this.nftOwners.slice().map(owner => {
      return {
        id: `${this.nftDid}#owner`,
        type: 'BlockchainVerificationMethod2021',
        controller: this.nftDid,
        blockchainAccountId: `${owner}@eip155:1`
      } as VerificationMethod;
    });
    return this;
  }

  setVersionId(versionId: string): NftDidVectorBuilder {
    this.versionId = versionId;
    return this;
  }

  // Should be ISOString
  setVersionTime(versionTime: string): NftDidVectorBuilder {
    this.versionTime = versionTime;
    return this;
  }

  build(): NftDidVector {
    if (!this.nftDid) this.nftDid = this.makeDid();

    if (!this.errorMessage && !this.verificationMethods) 
      this.verificationMethods = this.makeVerificationMethods();

    return new NftDidVector(this);
  }

  private makeDid(): string {
    if (!this.nftContract || !this.nftId) {
      throw new Error("Must provide contract address and id OR DID.")
    }
    return `did:nft:eip155.1_${this.nftNamespace}.${this.nftContract}_${this.nftId}`;
  }

  private makeVerificationMethods(): VerificationMethod[] {
    if (!this.nftOwners) {
      throw new Error("Must provide NftOwners");
    } else if (!this.nftDid) {
      throw new Error("Must provide Nft DID or args");
    }

    return this.nftOwners.slice().map(owner => {
      return {
        id: `${this.nftDid}#owner`,
        type: 'BlockchainVerificationMethod2021',
        controller: this.nftDid,
        blockchainAccountId: `${owner}@eip155:1`
      } as VerificationMethod;
    });
  }
}
