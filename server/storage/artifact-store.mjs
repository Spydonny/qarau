import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const ALLOWED_PREFIXES = Object.freeze(["raw/", "normalized/", "analysis/", "packages/"]);
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function validateArtifactKey(key) {
  if (typeof key !== "string" || key.length > 512 || !ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) throw new Error("invalid_artifact_key");
  if (key.includes("..") || key.includes("\\") || key.includes("//") || [...key].some((character) => {
    const point = character.codePointAt(0);
    return point !== undefined && (point <= 0x1f || point === 0x7f);
  })) throw new Error("invalid_artifact_key");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(key)) throw new Error("invalid_artifact_key");
  return key;
}

function contentHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isMissing(error) {
  return error?.$metadata?.httpStatusCode === 404 || ["NotFound", "NoSuchKey"].includes(error?.name);
}

export class S3ArtifactStore {
  constructor({ client, bucket, requireServerSideEncryption = true, maxBytes = 100 * 1024 * 1024 }) {
    if (!bucket) throw new Error("artifact_bucket_required");
    this.client = client;
    this.bucket = bucket;
    this.requireServerSideEncryption = requireServerSideEncryption;
    this.maxBytes = maxBytes;
  }

  static fromEnvironment(environment = process.env) {
    const required = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
    for (const name of required) if (!environment[name]) throw new Error(`missing_artifact_environment:${name}`);
    return new S3ArtifactStore({
      bucket: environment.S3_BUCKET,
      requireServerSideEncryption: environment.S3_REQUIRE_SSE !== "false",
      client: new S3Client({
        endpoint: environment.S3_ENDPOINT,
        region: environment.S3_REGION,
        forcePathStyle: true,
        credentials: { accessKeyId: environment.S3_ACCESS_KEY_ID, secretAccessKey: environment.S3_SECRET_ACCESS_KEY },
      }),
    });
  }

  async head(key) {
    validateArtifactKey(key);
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return Object.freeze({
        bytes: Number(result.ContentLength),
        contentSha256: result.Metadata?.["content-sha256"] ?? null,
        artifactHash: result.Metadata?.["artifact-hash"] ?? null,
        contentType: result.ContentType ?? null,
        serverSideEncryption: result.ServerSideEncryption ?? null,
      });
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async putOnce({ key, bytes, artifactHash, contentType = "application/octet-stream" }) {
    validateArtifactKey(key);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > this.maxBytes) throw new Error("invalid_artifact_bytes");
    if (!HASH_PATTERN.test(artifactHash)) throw new Error("invalid_artifact_hash");
    const digest = contentHash(bytes);
    const existing = await this.head(key);
    if (existing) {
      if (existing.bytes !== bytes.length || existing.contentSha256 !== digest || existing.artifactHash !== artifactHash) throw new Error("immutable_artifact_conflict");
      return Object.freeze({ created: false, key, ...existing });
    }

    const input = {
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentLength: bytes.length,
      ContentType: contentType,
      IfNoneMatch: "*",
      Metadata: { "content-sha256": digest, "artifact-hash": artifactHash },
    };
    if (this.requireServerSideEncryption) input.ServerSideEncryption = "AES256";
    try {
      await this.client.send(new PutObjectCommand(input));
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 412 && error?.name !== "PreconditionFailed") throw error;
    }

    const stored = await this.head(key);
    if (!stored || stored.bytes !== bytes.length || stored.contentSha256 !== digest || stored.artifactHash !== artifactHash) throw new Error("artifact_verification_failed");
    if (this.requireServerSideEncryption && stored.serverSideEncryption !== "AES256") throw new Error("artifact_encryption_missing");
    return Object.freeze({ created: true, key, ...stored });
  }

  async getStream(key) {
    validateArtifactKey(key);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error("artifact_body_missing");
    return result.Body;
  }

  async authorizedStream({ key, authorize }) {
    if (typeof authorize !== "function" || await authorize() !== true) throw new Error("artifact_access_denied");
    return this.getStream(key);
  }
}
