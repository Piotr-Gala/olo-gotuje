import "server-only";
import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { VideoStorage } from "./video-service";

const missing = (error: unknown) => {
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === "NoSuchKey" || value.name === "NoSuchUpload" || value.name === "NotFound" || value.$metadata?.httpStatusCode === 404;
};
export function createVideoStorage(): VideoStorage {
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) throw new Error("video-unconfigured");
  const client = new S3Client({ region: "auto", endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
  const object = (key: string) => ({ Bucket: R2_BUCKET, Key: key });
  const abort = async (key: string, uploadId: string) => {
    try { await client.send(new AbortMultipartUploadCommand({ ...object(key), UploadId: uploadId })); }
    catch (error) { if (!missing(error)) throw error; }
  };
  return {
    async start(key) {
      const result = await client.send(new CreateMultipartUploadCommand({ ...object(key), ContentType: "video/mp4", CacheControl: "private, no-store" }));
      if (!result.UploadId) throw new Error("video-storage");
      return result.UploadId;
    },
    async parts(key, uploadId) {
      const result = await client.send(new ListPartsCommand({ ...object(key), UploadId: uploadId }));
      if (result.IsTruncated) throw new Error("video-parts");
      return (result.Parts ?? []).map(part => ({ number: part.PartNumber!, size: part.Size!, etag: part.ETag! }));
    },
    partUrl: (key, uploadId, number, size) => getSignedUrl(client,
      new UploadPartCommand({ ...object(key), UploadId: uploadId, PartNumber: number, ContentLength: size }),
      { expiresIn: 300, signableHeaders: new Set(["content-length"]) }),
    async complete(key, uploadId, parts) {
      try {
        await client.send(new CompleteMultipartUploadCommand({ ...object(key), UploadId: uploadId,
          MultipartUpload: { Parts: parts.map(part => ({ PartNumber: part.number, ETag: part.etag })) } }));
      } catch (error) { if (!missing(error)) throw error; }
    },
    async inspect(key) {
      try {
        const head = await client.send(new HeadObjectCommand(object(key)));
        const first = await client.send(new GetObjectCommand({ ...object(key), Range: "bytes=0-31" }));
        return { size: head.ContentLength ?? 0, type: head.ContentType ?? "", header: await first.Body!.transformToByteArray() };
      } catch (error) { if (missing(error)) return null; throw error; }
    },
    readUrl: key => getSignedUrl(client, new GetObjectCommand({ ...object(key), ResponseCacheControl: "private, no-store" }), { expiresIn: 900 }),
    abort,
    async remove(key, uploadId) {
      if (uploadId) await abort(key, uploadId);
      await client.send(new DeleteObjectCommand(object(key)));
    },
  };
}
