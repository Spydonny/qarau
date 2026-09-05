import { createHash, randomBytes } from "node:crypto";

function normalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non_finite_value");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  throw new TypeError("non_canonical_value");
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

function hash(...parts) {
  const digest = createHash("sha256");
  for (const part of parts) digest.update(part);
  return digest.digest("hex");
}

export function commitmentLeaf(domain, record, salt = randomBytes(32)) {
  if (!/^QARAU_(SOURCE|ANALYSIS)_V1$/.test(domain) || !Buffer.isBuffer(salt) || salt.length !== 32) {
    throw new Error("invalid_commitment_input");
  }
  return hash(Buffer.from(`${domain}\0`, "utf8"), Buffer.from(canonicalJson(record)), salt);
}

export function merkleRoot(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0 || leaves.some((leaf) => !/^[a-f0-9]{64}$/i.test(leaf))) {
    throw new Error("invalid_merkle_leaves");
  }
  let level = leaves.map((leaf) => leaf.toLowerCase());
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      const right = level[index + 1] ?? level[index];
      next.push(hash(Buffer.from("QARAU_MERKLE_V1\0"), Buffer.from(level[index], "hex"), Buffer.from(right, "hex")));
    }
    level = next;
  }
  return level[0];
}

export function merkleTree(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0 || leaves.some((leaf) => !/^[a-f0-9]{64}$/i.test(leaf))) throw new Error("invalid_merkle_leaves");
  let level = leaves.map((leaf) => leaf.toLowerCase());
  const proofs = level.map(() => []);
  let indexes = level.map((_, index) => [index]);
  while (level.length > 1) {
    const next = [];
    const nextIndexes = [];
    for (let index = 0; index < level.length; index += 2) {
      const rightIndex = index + 1 < level.length ? index + 1 : index;
      const left = level[index];
      const right = level[rightIndex];
      for (const leafIndex of indexes[index]) proofs[leafIndex].push({ side: "right", hash: right });
      if (rightIndex !== index) for (const leafIndex of indexes[rightIndex]) proofs[leafIndex].push({ side: "left", hash: left });
      next.push(hash(Buffer.from("QARAU_MERKLE_V1\0"), Buffer.from(left, "hex"), Buffer.from(right, "hex")));
      nextIndexes.push([...indexes[index], ...(rightIndex === index ? [] : indexes[rightIndex])]);
    }
    level = next;
    indexes = nextIndexes;
  }
  return { root: level[0], proofs };
}

export function verifyMerkleProof(leaf, proof, root) {
  if (!/^[a-f0-9]{64}$/i.test(leaf) || !/^[a-f0-9]{64}$/i.test(root) || !Array.isArray(proof)) return false;
  let value = leaf.toLowerCase();
  for (const item of proof) {
    if (!item || !["left", "right"].includes(item.side) || !/^[a-f0-9]{64}$/i.test(item.hash)) return false;
    value = item.side === "left"
      ? hash(Buffer.from("QARAU_MERKLE_V1\0"), Buffer.from(item.hash, "hex"), Buffer.from(value, "hex"))
      : hash(Buffer.from("QARAU_MERKLE_V1\0"), Buffer.from(value, "hex"), Buffer.from(item.hash, "hex"));
  }
  return value === root.toLowerCase();
}

export function newSalt() {
  return randomBytes(32);
}
