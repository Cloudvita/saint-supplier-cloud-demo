import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, W9_BUCKET } from "./clients";

export function w9Key(fileName: string) {
  const safe = fileName.replace(/[^\w.\-]/g, "_");
  const d = new Date();
  return `w9/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}-${safe}`;
}

/** Store the original W-9 for audit. Returns null if no bucket is configured. */
export async function putW9(
  key: string,
  bytes: Uint8Array,
  contentType: string
): Promise<{ bucket: string; key: string } | null> {
  if (!W9_BUCKET) return null;
  await s3.send(
    new PutObjectCommand({
      Bucket: W9_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    })
  );
  return { bucket: W9_BUCKET, key };
}

/** Short-lived link so a buyer can re-open the stored W-9. */
export async function presignW9(key: string, expiresIn = 300) {
  if (!W9_BUCKET) return null;
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: W9_BUCKET, Key: key }), { expiresIn });
}
