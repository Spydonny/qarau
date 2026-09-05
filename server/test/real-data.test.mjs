import assert from "node:assert/strict";
import test from "node:test";
import {
  parseEcbCsv,
  parseOpenMeteo,
  parseUsgs,
  parseWorldBank,
} from "../providers/real-data.mjs";

test("Open-Meteo parser keeps real timestamps and availability delay", () => {
  const rows = parseOpenMeteo({ daily: { time: ["2025-01-01", "2025-01-02"], precipitation_sum: [2.5, 0] } }, "precipitation_sum", 5);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].value, 2.5);
  assert.equal(rows[0].availableAt, "2025-01-06T00:00:00.000Z");
});

test("USGS parser rejects qualifiers and aggregates observations by UTC day", () => {
  const payload = { value: { timeSeries: [{ values: [{ value: [
    { dateTime: "2025-01-01T01:00:00Z", value: "2", qualifiers: ["A"] },
    { dateTime: "2025-01-01T02:00:00Z", value: "4", qualifiers: ["A"] },
    { dateTime: "2025-01-02T01:00:00Z", value: "Ice", qualifiers: ["P"] },
  ] }] }] } };
  assert.deepEqual(parseUsgs(payload), [{ timestamp: "2025-01-01T00:00:00.000Z", value: 3, availableAt: "2025-01-02T00:00:00.000Z" }]);
});

test("World Bank and ECB parsers normalize published values", () => {
  assert.deepEqual(parseWorldBank([{}, [{ date: "2025", value: null }, { date: "2024", value: 42 }]]), [{ timestamp: "2024-01-01T00:00:00.000Z", value: 42, availableAt: "2024-12-31T00:00:00.000Z" }]);
  const csv = "KEY,TIME_PERIOD,OBS_VALUE\nEXR,2025-01-02,1.04\n";
  assert.deepEqual(parseEcbCsv(csv), [{ timestamp: "2025-01-02T00:00:00.000Z", price: 1.04 }]);
});
