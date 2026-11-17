/**
 * Integration-test helpers for blob storage: the store on the compose emulator's test bucket
 * (`crate-designer-test`), and a random org id so parallel test files never share keys.
 */
import { randomUUID } from "node:crypto";
import { orgContext, type OrgContext } from "../db/org";
import { blobConfig } from "./config";
import { createS3BlobStore } from "./s3";

export const TEST_BUCKET = "crate-designer-test";

export const testBlobConfig = () => ({ ...blobConfig(), bucket: TEST_BUCKET });

export const createTestBlobStore = () => createS3BlobStore(testBlobConfig());

/** An org nobody else uses (keys only: it has no `org` row). */
export const scratchOrg = (): OrgContext => orgContext(randomUUID());
