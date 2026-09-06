import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceBytes } from "../ingestion/parsers.mjs";

test("parses JSON REST rows and infers every numeric field", () => {
  const parsed = parseSourceBytes({ sourceType: "json_api", contentType: "application/json", bytes: Buffer.from(JSON.stringify({ data: [{ date: "2025-01-01", rain_mm: 2.5, wind: 7 }, { date: "2025-01-02", rain_mm: 3.5, wind: 8 }] })) });
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.schema.value_fields, ["rain_mm", "wind"]);
  assert.equal(parsed.rows[0].values.rain_mm, 2.5);
});

test("parses quoted CSV downloads without treating commas inside a field as columns", () => {
  const parsed = parseSourceBytes({ sourceType: "download", contentType: "text/csv", url: "https://example.test/data.csv", bytes: Buffer.from('date,value,place\n2025-01-01,4,"Port, A"\n2025-01-02,5,"Port B"\n') });
  assert.equal(parsed.sourceKind, "csv");
  assert.equal(parsed.rows[1].values.value, 5);
});

test("parses an inert HTML table and rejects markup without data", () => {
  const parsed = parseSourceBytes({ sourceType: "html", contentType: "text/html", bytes: Buffer.from("<table><tr><th>Date</th><th>Count</th></tr><tr><td>2025-01-01</td><td>10</td></tr><tr><td>2025-01-02</td><td>12</td></tr></table>") });
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].values.count, 10);
  assert.throws(() => parseSourceBytes({ sourceType: "html", bytes: Buffer.from("<h1>Not a table</h1>") }), /html_table_not_found/);
});
