import { S3ArtifactStore } from "./artifact-store.mjs";
import { MongoArtifactStore } from "./mongo-artifact-store.mjs";

export function createArtifactStore({ db, environment = process.env }) {
  return environment.ARTIFACT_STORE === "mongodb"
    ? new MongoArtifactStore({ db })
    : S3ArtifactStore.fromEnvironment(environment);
}
