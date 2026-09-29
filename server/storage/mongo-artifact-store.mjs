import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { validateArtifactKey } from "./artifact-store.mjs";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CHUNK_BYTES = 1024 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export class MongoArtifactStore {
  constructor({ db, maxBytes = 100 * 1024 * 1024 }) {
    if (!db) throw new Error("artifact_database_required");
    this.db = db;
    this.maxBytes = maxBytes;
    this.manifests = db.collection("private_artifact_manifests");
    this.chunks = db.collection("private_artifact_chunks");
  }

  async ready() {
    await this.db.command({ ping: 1 });
    return true;
  }

  async head(key) {
    validateArtifactKey(key);
    const manifest = await this.manifests.findOne({ _id: key });
    if (!manifest) return null;
    return Object.freeze({
      bytes: manifest.bytes,
      contentSha256: manifest.content_sha256,
      artifactHash: manifest.artifact_hash,
      contentType: manifest.content_type,
      serverSideEncryption: null,
    });
  }

  async putOnce({ key, bytes, artifactHash, contentType = "application/octet-stream" }) {
    validateArtifactKey(key);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > this.maxBytes) throw new Error("invalid_artifact_bytes");
    if (!HASH_PATTERN.test(artifactHash)) throw new Error("invalid_artifact_hash");
    const digest = sha256(bytes);
    const existing = await this.head(key);
    if (existing) {
      if (existing.bytes !== bytes.length || existing.contentSha256 !== digest || existing.artifactHash !== artifactHash) throw new Error("immutable_artifact_conflict");
      return Object.freeze({ created: false, key, ...existing });
    }

    const count = Math.ceil(bytes.length / CHUNK_BYTES);
    for (let index = 0; index < count; index += 1) {
      const chunk = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
      const id = `${key}:${index}`;
      try {
        await this.chunks.insertOne({ _id: id, bytes: chunk });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        const stored = await this.chunks.findOne({ _id: id });
        if (!stored || !Buffer.from(stored.bytes).equals(chunk)) throw new Error("immutable_artifact_conflict");
      }
    }

    try {
      // The manifest is written last, so readers never see an incomplete upload.
      await this.manifests.insertOne({ _id: key, bytes: bytes.length, chunk_count: count, content_sha256: digest, artifact_hash: artifactHash, content_type: contentType });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    const stored = await this.head(key);
    if (!stored || stored.bytes !== bytes.length || stored.contentSha256 !== digest || stored.artifactHash !== artifactHash) throw new Error("immutable_artifact_conflict");
    await this.getVerifiedBytes({ key, expectedArtifactHash: artifactHash });
    return Object.freeze({ created: true, key, ...stored });
  }

  async getVerifiedBytes({ key, expectedArtifactHash = null }) {
    validateArtifactKey(key);
    const manifest = await this.manifests.findOne({ _id: key });
    if (!manifest) throw new Error("artifact_not_found");
    if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 || manifest.bytes > this.maxBytes || !Number.isSafeInteger(manifest.chunk_count) || manifest.chunk_count !== Math.ceil(manifest.bytes / CHUNK_BYTES)) throw new Error("artifact_length_mismatch");
    if (!HASH_PATTERN.test(manifest.content_sha256 ?? "")) throw new Error("artifact_content_hash_mismatch");
    if (!HASH_PATTERN.test(manifest.artifact_hash ?? "")) throw new Error("artifact_hash_metadata_missing");
    if (expectedArtifactHash !== null) {
      const expected = Buffer.isBuffer(expectedArtifactHash) ? expectedArtifactHash.toString("hex") : String(expectedArtifactHash);
      if (!HASH_PATTERN.test(expected) || manifest.artifact_hash !== expected) throw new Error("artifact_commitment_mismatch");
    }
    const chunks = [];
    for (let index = 0; index < manifest.chunk_count; index += 1) {
      const chunk = await this.chunks.findOne({ _id: `${key}:${index}` });
      if (!chunk) throw new Error("artifact_body_missing");
      chunks.push(Buffer.from(chunk.bytes));
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== manifest.bytes) throw new Error("artifact_length_mismatch");
    if (sha256(bytes) !== manifest.content_sha256) throw new Error("artifact_content_hash_mismatch");
    return bytes;
  }

  async getStream(key) {
    return Readable.from([await this.getVerifiedBytes({ key })]);
  }

  async authorizedStream({ key, authorize }) {
    if (typeof authorize !== "function" || await authorize() !== true) throw new Error("artifact_access_denied");
    return this.getStream(key);
  }
}
