import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./pool.mjs";

const directory = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrate(pool = createPool()) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('qarau_schema_migrations_v1'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL CHECK (length(checksum) = 64),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
    const applied = [];
    for (const file of files) {
      const sql = await readFile(join(directory, file), "utf8");
      const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
      const existing = await client.query("SELECT checksum FROM schema_migrations WHERE version = $1", [file]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`migration_checksum_mismatch:${file}`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return Object.freeze({ applied, total: files.length });
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('qarau_schema_migrations_v1'))").catch(() => {});
    client.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const pool = createPool();
  try {
    const result = await migrate(pool);
    console.log(JSON.stringify({ event: "database_migrated", ...result }));
  } finally {
    await pool.end();
  }
}
