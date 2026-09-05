import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { S3ArtifactStore, validateArtifactKey } from "../storage/artifact-store.mjs";

class MemoryS3 {
  objects = new Map();

  async send(command) {
    const { Bucket: _bucket, Key, ...input } = command.input;
    if (command.constructor.name === "HeadObjectCommand") {
      const object = this.objects.get(Key);
      if (!object) throw Object.assign(new Error("missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: object.bytes.length, Metadata: object.metadata, ContentType: object.contentType, ServerSideEncryption: object.encryption };
    }
    if (command.constructor.name === "PutObjectCommand") {
      if (this.objects.has(Key)) throw Object.assign(new Error("exists"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
      this.objects.set(Key, { bytes: Buffer.from(input.Body), metadata: input.Metadata, contentType: input.ContentType, encryption: input.ServerSideEncryption });
      return {};
    }
    if (command.constructor.name === "GetObjectCommand") {
      const object = this.objects.get(Key);
      if (!object) throw Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      return { Body: Readable.from(object.bytes) };
    }
    throw new Error("unsupported_test_command");
  }
}

test("artifact keys are role-prefixed and traversal safe", () => {
  assert.equal(validateArtifactKey("raw/source/snapshot/response-body.bin"), "raw/source/snapshot/response-body.bin");
  for (const key of ["private/file", "raw/../secret", "raw/a\\b", "raw//file", "/raw/file"]) assert.throws(() => validateArtifactKey(key), /invalid_artifact_key/);
});

test("putOnce is idempotent for identical bytes and rejects replacement", async () => {
  const client = new MemoryS3();
  const store = new S3ArtifactStore({ client, bucket: "qarau-private" });
  const artifactHash = "a".repeat(64);
  const first = await store.putOnce({ key: "analysis/run/results.json", bytes: Buffer.from("one"), artifactHash, contentType: "application/json" });
  const repeat = await store.putOnce({ key: "analysis/run/results.json", bytes: Buffer.from("one"), artifactHash, contentType: "application/json" });
  assert.equal(first.created, true);
  assert.equal(repeat.created, false);
  assert.equal(first.serverSideEncryption, "AES256");
  await assert.rejects(() => store.putOnce({ key: "analysis/run/results.json", bytes: Buffer.from("two"), artifactHash }), /immutable_artifact_conflict/);
});

test("streaming requires an explicit successful authorization decision", async () => {
  const store = new S3ArtifactStore({ client: new MemoryS3(), bucket: "qarau-private" });
  await store.putOnce({ key: "packages/id/report.json", bytes: Buffer.from("report"), artifactHash: "b".repeat(64) });
  await assert.rejects(() => store.authorizedStream({ key: "packages/id/report.json", authorize: async () => false }), /artifact_access_denied/);
  const stream = await store.authorizedStream({ key: "packages/id/report.json", authorize: async () => true });
  let output = "";
  for await (const chunk of stream) output += chunk;
  assert.equal(output, "report");
});
