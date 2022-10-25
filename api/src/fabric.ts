/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import * as grpc from '@grpc/grpc-js'
import {
  connect,
  Contract,
  Identity,
  Signer,
  signers
} from '@hyperledger/fabric-gateway'
import * as crypto from 'crypto'
import { promises as fs } from 'fs'
import * as path from 'path'
import { TextDecoder } from 'util'
import { env } from './env'

const channelName = env.CHANNEL_NAME
const chaincodeName = env.CHAINCODE_NAME
const mspId = env.MSP_ID_ORG1

// Path to crypto materials.
const cryptoPath = envOrDefault(
  'CRYPTO_PATH',
  path.resolve(
    __dirname,
    '..',
    '..',
    'network',
    'organizations',
    'peerOrganizations',
    'org1.example.com'
  )
)

// Path to user private key directory.
const keyDirectoryPath = envOrDefault(
  'KEY_DIRECTORY_PATH',
  path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore')
)

// Path to user certificate.
const certPath = envOrDefault(
  'CERT_PATH',
  path.resolve(
    cryptoPath,
    'users',
    'User1@org1.example.com',
    'msp',
    'signcerts',
    'cert.pem'
  )
)

// Path to peer tls certificate.
const tlsCertPath = envOrDefault(
  'TLS_CERT_PATH',
  path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt')
)

// Gateway peer endpoint.
const peerEndpoint = envOrDefault('PEER_ENDPOINT', 'localhost:7051')

// Gateway peer SSL host name override.
const peerHostAlias = envOrDefault('PEER_HOST_ALIAS', 'peer0.org1.example.com')

const utf8Decoder = new TextDecoder()
let contract: Contract
export async function main(): Promise<void> {
  await displayInputParameters()

  // The gRPC client connection should be shared by all Gateway connections to this endpoint.
  const client = await newGrpcConnection()

  const gateway = connect({
    client,
    identity: await newIdentity(),
    signer: await newSigner(),
    // Default timeouts for different gRPC calls
    evaluateOptions: () => {
      return { deadline: Date.now() + 5000 } // 5 seconds
    },
    endorseOptions: () => {
      return { deadline: Date.now() + 15000 } // 15 seconds
    },
    submitOptions: () => {
      return { deadline: Date.now() + 5000 } // 5 seconds
    },
    commitStatusOptions: () => {
      return { deadline: Date.now() + 60000 } // 1 minute
    }
  })

  try {
    // Get a network instance representing the channel where the smart contract is deployed.
    const network = gateway.getNetwork(channelName)

    // Get the smart contract from the network.
    contract = network.getContract(chaincodeName)

    // Initialize a set of asset data on the ledger using the chaincode 'InitLedger' function.
    await initLedger()
  } finally {
    // gateway.close()
    // client.close()
  }
}

async function newGrpcConnection(): Promise<grpc.Client> {
  const tlsRootCert = await fs.readFile(tlsCertPath)
  const tlsCredentials = grpc.credentials.createSsl(tlsRootCert)
  return new grpc.Client(peerEndpoint, tlsCredentials, {
    'error.ssl_target_name_override': peerHostAlias
  })
}

async function newIdentity(): Promise<Identity> {
  const credentials = await fs.readFile(certPath)
  return { mspId, credentials }
}

async function newSigner(): Promise<Signer> {
  const files = await fs.readdir(keyDirectoryPath)
  const keyPath = path.resolve(keyDirectoryPath, files[0])
  const privateKeyPem = await fs.readFile(keyPath)
  const privateKey = crypto.createPrivateKey(privateKeyPem)
  return signers.newPrivateKeySigner(privateKey)
}

/**
 * Initialize the ledger to get some Real Estate and Users
 *
 */
export async function initLedger(): Promise<void> {
  console.log('Init ledger')

  await contract.submitTransaction('InitLedger')

  console.log('*** Init ledger successfully')
}

/**
 * Evaluate a transaction to query ledger state.
 * @author Thai Hoang Tam
 * @return all assets from ledger
 */
export async function getAllAssets(): Promise<string> {
  try {
    console.log('Get all assets')
    const resultBytes = await contract.evaluateTransaction('GetAllAssets')
    const resultJson = utf8Decoder.decode(resultBytes)
    const result = JSON.parse(resultJson)
    console.log('*** Result:', result)
    return result
  } catch (error: any) {
    console.log(error)
    return error
  }
}

/**
 * Create new Real Estate
 * @author Thai Hoang Tam
 * @param assetID
 * @param roomList
 * @param area
 * @param location
 * @param owners
 * @param membershipScore
 */
export async function createRealEstate(
  // contract: Contract,
  assetID: string,
  roomList: string,
  area: string,
  location: string,
  owners: string,
  membershipScore: string
): Promise<string> {
  try {
    console.log('Create Real Estate')
    const result = await contract.submitTransaction(
      'CreateRealEstate',
      assetID,
      roomList,
      area,
      location,
      owners,
      membershipScore
    )
    console.log('*** Real Estate created')
    return result.toString()
  } catch (error: any) {
    console.log(error)
    return error
  }
}

/**
 * Create a new user with a starting balance
 * @author Thai Hoang Tam
 * @param userID
 * @param balance
 * @returns
 */
export async function createUser(userID: string, balance: string) {
  try {
    console.log('Create user')
    const resultBytes = await contract.submitTransaction(
      'CreateUser',
      userID,
      balance
    )
    const resultJson = utf8Decoder.decode(resultBytes)
    const result = JSON.parse(resultJson)
    console.log('*** Result:', result)
    return result
  } catch (error) {
    console.log(error)
    return error
  }
}

/**
 * Submit transaction asynchronously, allowing the application to process the smart contract response (e.g. update a UI)
 * while waiting for the commit notification.
 */
export async function transferRealEstate(
  // contract: Contract,
  assetID: string,
  sellerID: string,
  buyerID: string,
  buyPercentage: string
): Promise<string> {
  let result
  try {
    console.log('Transfer Real Estate')

    const commit = await contract.submitAsync('TransferRealEstate', {
      arguments: [assetID, sellerID, buyerID, buyPercentage]
    })
    result = utf8Decoder.decode(commit.getResult())

    // console.log('*** Waiting for transaction commit')

    const status = await commit.getStatus()
    if (!status.successful) {
      throw new Error(
        `Transaction ${status.transactionId} failed to commit with status code ${status.code}`
      )
    }
    console.log('*** Transaction committed successfully')
    return result
  } catch (error: any) {
    console.log(error)
    return error
  }
}

/**
 * Return an asset read from world state
 * @author Thai Hoang Tam
 * @param assetID
 * @returns asset as json object
 */
export async function readAsset(
  // contract: Contract,
  assetID: string
): Promise<string> {
  console.log('Read Asset')
  let result
  try {
    const resultBytes = await contract.evaluateTransaction('ReadAsset', assetID)
    const resultJson = utf8Decoder.decode(resultBytes)
    console.log(resultJson)
    result = JSON.parse(resultJson)
    console.log('*** Result:', result)
    return result
  } catch (error: any) {
    console.log(error)
    console.log('error ' + error.details[0].message)
    return error.details[0].message
  }
}

/**
 * Delete an asset from the world state
 * @author Thai Hoang Tam
 * @param assetID
 * @returns
 */
export async function deleteAsset(assetID: string): Promise<string> {
  try {
    console.log('Delete asset')
    const resultBytes = await contract.submitTransaction('DeleteAsset', assetID)
    const resultJson = utf8Decoder.decode(resultBytes)
    const result = JSON.parse(resultJson)
    console.log('*** Result:', result)
    return result
  } catch (error: any) {
    console.log(error)
    return error
  }
}

/**
 * Check if asset exists
 * @param assetID
 * @returns
 */
export async function assetExists(assetID: string): Promise<string> {
  try {
    console.log('Asset Exist')
    const resultBytes = await contract.evaluateTransaction(
      'AssetExists',
      assetID
    )
    const resultJson = utf8Decoder.decode(resultBytes)
    const result = JSON.parse(resultJson)
    console.log('*** Result:', result)
    return result
  } catch (error: any) {
    console.log(error)
    return error
  }
}

/**
 * Update an real estate
 * @author Thai Hoang Tam
 * @param assetID
 * @param roomList
 * @param area
 * @param location
 * @param owners
 * @param membershipScore
 * @returns
 */
export async function updateRealEstate(
  // contract: Contract
  assetID: string,
  roomList: string,
  area: string,
  location: string,
  owners: string,
  membershipScore: string
) {
  try {
    console.log('Update Real Estate')
    const resultBytes = await contract.evaluateTransaction(
      'UpdateRealEstate',
      assetID,
      roomList,
      area,
      location,
      owners,
      membershipScore
    )
    const resultJson = utf8Decoder.decode(resultBytes)
    const result = JSON.parse(resultJson)
    console.log('*** Result:', result)
    return result
  } catch (error) {
    console.log(error)
    return error
  }
}

/**
 * Update a user information
 * @author Thai Hoang Tam
 * @param assetID
 * @param balance
 * @param membershipScore
 * @returns
 */
export async function updateUser(
  assetID: string,
  balance: string,
  membershipScore: string
): Promise<string> {
  try {
    console.log('Update User')
    const resultBytes = await contract.evaluateTransaction(
      'UpdateUser',
      assetID,
      balance,
      membershipScore
    )
    const resultJson = utf8Decoder.decode(resultBytes)
    const result = JSON.parse(resultJson)
    console.log('*** Result:', result)
    return result
  } catch (error: any) {
    console.log(error)
    return error
  }
}

function envOrDefault(key: string, defaultValue: string) {
  return process.env[key] || defaultValue
}

/**
 * displayInputParameters() will print the global scope parameters used by the main driver routine.
 */
async function displayInputParameters(): Promise<void> {
  console.log(`channelName:       ${channelName}`)
  console.log(`chaincodeName:     ${chaincodeName}`)
  console.log(`mspId:             ${mspId}`)
  console.log(`cryptoPath:        ${cryptoPath}`)
  console.log(`keyDirectoryPath:  ${keyDirectoryPath}`)
  console.log(`certPath:          ${certPath}`)
  console.log(`tlsCertPath:       ${tlsCertPath}`)
  console.log(`peerEndpoint:      ${peerEndpoint}`)
  console.log(`peerHostAlias:     ${peerHostAlias}`)
}
