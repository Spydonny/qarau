export function testDatabaseUrl(environment = process.env) {
  const value = environment.TEST_DATABASE_URL;
  if (!value) return undefined;
  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error(`Refusing to run integration tests against non-test database: ${databaseName || "<missing>"}`);
  }
  return value;
}
