const MAX_ROWS = 500_000;
const TIME_FIELDS = Object.freeze(["timestamp", "time", "datetime", "date", "period", "observation_date"]);
const AVAILABLE_FIELDS = Object.freeze(["available_at", "availableat", "published_at", "publishedat", "retrieved_at", "retrievedat"]);

function fail(code) { throw new Error(code); }

function plain(value) { return value && typeof value === "object" && !Array.isArray(value); }

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function finite(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = clean(value).replaceAll(",", "");
  if (!text || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalizeHeader(value, index) {
  const header = clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return header || `column_${index + 1}`;
}

function timestamp(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function parseCsv(text) {
  const rows = [];
  let cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      cells.push(cell); cell = "";
      if (cells.some((value) => clean(value))) rows.push(cells);
      cells = [];
    } else cell += character;
  }
  if (quoted) fail("invalid_csv_quote");
  cells.push(cell);
  if (cells.some((value) => clean(value))) rows.push(cells);
  return rows;
}

function recordsFromMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 2) fail("source_has_no_records");
  const headers = matrix[0].map(normalizeHeader);
  if (new Set(headers).size !== headers.length) fail("duplicate_source_columns");
  return matrix.slice(1, MAX_ROWS + 1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, clean(cells[index])])));
}

function decodeHtml(value) {
  return clean(value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'"));
}

export function parseHtmlTables(html) {
  const tables = String(html).match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) ?? [];
  let best = null;
  for (const table of tables) {
    const matrix = (table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
      (row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(decodeHtml),
    ).filter((cells) => cells.length > 0);
    if (matrix.length >= 2 && (!best || matrix.length > best.length)) best = matrix;
  }
  if (!best) fail("html_table_not_found");
  return recordsFromMatrix(best);
}

function jsonRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!plain(payload)) fail("unsupported_json_source_shape");
  for (const key of ["data", "rows", "results", "observations", "items"]) if (Array.isArray(payload[key])) return payload[key];
  for (const value of Object.values(payload)) if (Array.isArray(value) && value.every((item) => plain(item))) return value;
  fail("unsupported_json_source_shape");
}

function inferColumns(records) {
  if (!Array.isArray(records) || records.length === 0) fail("source_has_no_records");
  const sample = records.slice(0, Math.min(records.length, 200)).filter(plain);
  if (sample.length === 0) fail("invalid_source_records");
  const keys = [...new Set(sample.flatMap((row) => Object.keys(row)))];
  const normalized = new Map(keys.map((key) => [key, normalizeHeader(key, 0)]));
  const byNormalized = new Map([...normalized].map(([key, name]) => [name, key]));
  const timeKey = TIME_FIELDS.map((name) => byNormalized.get(name)).find(Boolean)
    ?? keys.find((key) => sample.filter((row) => timestamp(row[key])).length >= Math.max(2, sample.length * .8));
  if (!timeKey) fail("timestamp_column_not_found");
  const availableKey = AVAILABLE_FIELDS.map((name) => byNormalized.get(name)).find(Boolean) ?? null;
  const numericKeys = keys.filter((key) => key !== timeKey && key !== availableKey && sample.some((row) => finite(row[key]) !== null));
  if (!numericKeys.length) fail("numeric_column_not_found");
  return { timeKey, availableKey, numericKeys, normalized };
}

export function normalizeSourceRecords(records) {
  const columns = inferColumns(records);
  const dropped = { invalidTimestamp: 0, missingNumeric: 0 };
  const rows = [];
  for (const record of records.slice(0, MAX_ROWS)) {
    if (!plain(record)) continue;
    const at = timestamp(record[columns.timeKey]);
    if (!at) { dropped.invalidTimestamp += 1; continue; }
    const availableAt = timestamp(record[columns.availableKey]) ?? at;
    const values = Object.fromEntries(columns.numericKeys.flatMap((key) => {
      const value = finite(record[key]);
      return value === null ? [] : [[columns.normalized.get(key), value]];
    }));
    if (!Object.keys(values).length) { dropped.missingNumeric += 1; continue; }
    rows.push({ timestamp: at, availableAt, values });
  }
  if (!rows.length) fail("source_has_no_usable_records");
  return Object.freeze({
    rows: Object.freeze(rows),
    schema: Object.freeze({ timestamp_field: columns.normalized.get(columns.timeKey), available_at_field: columns.availableKey ? columns.normalized.get(columns.availableKey) : null, value_fields: columns.numericKeys.map((key) => columns.normalized.get(key)) }),
    dropped: Object.freeze(dropped),
  });
}

function contentKind({ sourceType, contentType, url, bytes }) {
  if (sourceType !== "download") return sourceType;
  const type = String(contentType ?? "").toLowerCase();
  const path = String(url ?? "").toLowerCase().split("?")[0];
  const preview = Buffer.from(bytes).subarray(0, 512).toString("utf8").trimStart();
  if (type.includes("json") || path.endsWith(".json") || /^[{[]/.test(preview)) return "json_api";
  if (type.includes("html") || /<table\b/i.test(preview)) return "html";
  if (type.includes("csv") || path.endsWith(".csv") || preview.includes(",")) return "csv";
  fail("unsupported_download_format");
}

/** Parses untrusted source bytes without executing markup or code. */
export function parseSourceBytes({ sourceType, bytes, contentType = "", url = "" }) {
  if (!["json_api", "csv", "html", "download"].includes(sourceType)) fail("unsupported_source_type");
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail("invalid_source_bytes");
  const kind = contentKind({ sourceType, contentType, url, bytes });
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  let records;
  if (kind === "json_api") {
    let payload;
    try { payload = JSON.parse(text); } catch { fail("invalid_source_json"); }
    records = jsonRecords(payload);
  } else if (kind === "csv") records = recordsFromMatrix(parseCsv(text));
  else records = parseHtmlTables(text);
  const normalized = normalizeSourceRecords(records);
  return Object.freeze({ parserName: `${kind}_tabular_v1`, parserVersion: "1", sourceKind: kind, ...normalized });
}
