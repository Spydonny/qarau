export function testDatabaseUrl(environment = process.env) {
  const value = environment.TEST_MONGODB_URI;
  if (!value) return undefined;
  let databaseName;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "mongodb:" && parsed.protocol !== "mongodb+srv:") throw new Error("bad-scheme");
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "").split("/")[0]);
  } catch {
    throw new Error("TEST_MONGODB_URI must be a valid MongoDB connection string (mongodb:// or mongodb+srv://)");
  }
  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error(`Refusing to run integration tests against non-test database: ${databaseName || "<missing>"}`);
  }
  return value;
}
