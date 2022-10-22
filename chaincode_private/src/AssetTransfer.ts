import {
    Contract,
    Transaction,
    Context,
    Returns
} from 'fabric-contract-api'
import stringify from 'json-stringify-deterministic';
import sortKeysRecursive from 'sort-keys-recursive';
import { RealEstate } from './Asset'
import { AssetPrivateDetails } from './AssetPrivateDetails'
enum AssetTransferErrors {
    INCOMPLETE_INPUT,
    INVALID_ACCESS,
    ASSET_NOT_FOUND,
    ASSET_ALREADY_EXISTS
}

const RED = '\x1b[31m\n';
const RESET = '\x1b[0m';
export function doFail(msgString: string): never {
    console.error(`${RED}\t${msgString}${RESET}`);
    throw new Error(msgString);
}


const utf8Decoder = new TextDecoder();
export class AssetTransfer extends Contract {
    static ASSET_COLLECTION_NAME: string = "assetCollection"
    static AGREEMENT_KEYPREFIX: string = "transferAgreement";

    private static verifyClientOrgMatchesPeerOrg(ctx: Context): void {
        let clientMSPID: string = ctx.clientIdentity.getMSPID();
        let peerMSPID: string = ctx.stub.getMspID();

        if (peerMSPID != clientMSPID) {
            doFail(`Client from org ${clientMSPID} is not authorized to read or write private data from an org ${peerMSPID} peer`);
        }
    }

    private static getCollectionName(ctx: Context): string {
        // Get the MSP ID of submitting client identity
        let clientMSPID: string = ctx.clientIdentity.getMSPID();
        // Create the collection name
        return clientMSPID + "PrivateCollection";
    }

    @Transaction(false)
    @Returns('boolean')
    public async AssetExists(ctx: Context, id: string): Promise<boolean> {
        const assetJSON = await ctx.stub.getState(id);
        return assetJSON && assetJSON.length > 0;
    }
    public async CreateAsset(ctx: Context, assetID: string, area: number, location: string, owner: string, appraisedValue: number): Promise<RealEstate> {
        const exists = await this.AssetExists(ctx, assetID);
        if (exists) {
            throw new Error(`The asset ${assetID} already exists`);
        }
        //input validations
        if (assetID == "") {
            doFail("Empty input: assetID");
        }
        if (area <= 0) {
            doFail("Empty input: area");
        }
        if (location == "") {
            doFail("Empty input: location");
        }
        if (owner == "") {
            doFail("Empty input: owner");
        }

        let asset: RealEstate = new RealEstate(assetID, area, location, owner, appraisedValue);

        // we insert data in alphabetic order using 'json-stringify-deterministic' and 'sort-keys-recursive'
        await ctx.stub.putState(assetID, Buffer.from(stringify(sortKeysRecursive(asset))));

        // Get ID of submitting client identity
        let clientID: string = ctx.clientIdentity.getID()

        // Verify that the client is submitting request to peer in their organization
        // This is to ensure that a client from another org doesn't attempt to read or
        // write private data from this peer.
        AssetTransfer.verifyClientOrgMatchesPeerOrg(ctx)

        //Make submitting client the owner
        asset.owner = clientID
        console.log(`CreateAsset Put: collection ${AssetTransfer.ASSET_COLLECTION_NAME}, ID ${assetID}\n`);
        console.log(`Put: collection ${AssetTransfer.ASSET_COLLECTION_NAME}, ID ${asset.serialize()}\n`);
        ctx.stub.putPrivateData(AssetTransfer.ASSET_COLLECTION_NAME, assetID, asset.serialize());

        // Get collection name for this organization.
        let orgCollectionName: string = AssetTransfer.getCollectionName(ctx);

        //Save AssetPrivateDetails to org collection
        let assetPriv: AssetPrivateDetails = new AssetPrivateDetails(assetID, appraisedValue);
        console.log("Put AssetPrivateDetails: collection ${orgCollectionName}, ${assetID}\n");
        ctx.stub.putPrivateData(orgCollectionName, assetID, assetPriv.serialize());

        return asset;
    }
}