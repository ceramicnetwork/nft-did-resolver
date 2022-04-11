import { jest } from '@jest/globals'
import { GlobalWithFetchMock } from 'jest-fetch-mock'
import jestFetchMock from 'jest-fetch-mock'

const customGlobal = global as unknown as GlobalWithFetchMock
customGlobal.fetch = jestFetchMock
customGlobal.fetchMock = customGlobal.fetch

jest.setMock('cross-fetch', fetch) // Use this to mock your ponyfilled fetch module

// don't mock by default
customGlobal.fetchMock.dontMock()
