import { TextractClient } from "@aws-sdk/client-textract";
import { S3Client } from "@aws-sdk/client-s3";
import { SESClient } from "@aws-sdk/client-ses";

const region = process.env.AWS_REGION || "us-east-1";

/**
 * No explicit credentials on purpose.
 * The AWS SDK default provider chain picks up:
 *   - local dev  -> ~/.aws/credentials or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 *   - App Runner -> the instance role attached to the service
 * Never hard-code keys.
 */
export const textract = new TextractClient({ region });
export const s3 = new S3Client({ region });
export const ses = new SESClient({ region });

export const W9_BUCKET = process.env.S3_W9_BUCKET || "";
export const AWS_REGION = region;
