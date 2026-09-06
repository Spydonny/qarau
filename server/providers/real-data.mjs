import { fetchExternalText } from "../lib/url-policy.mjs";

const DAY_MS = 86_400_000;
const MAX_PROVIDER_BYTES = 8_000_000;

export const SOURCE_CATALOG = Object.freeze([
  {
    key: "open_meteo_rotterdam_precipitation",
    provider: "OPEN_METEO",
    name: "Rotterdam daily precipitation",
    category: "Weather",
    region: "Netherlands",
    description: "Daily precipitation near the Port of Rotterdam from the Open-Meteo historical archive.",
    documentationUrl: "https://open-meteo.com/en/docs/historical-weather-api",
    config: { latitude: 51.9244, longitude: 4.4777, variable: "precipitation_sum", unit: "mm", availabilityDelayDays: 5 },
  },
  {
    key: "open_meteo_houston_temperature",
    provider: "OPEN_METEO",
    name: "Houston daily mean temperature",
    category: "Weather",
    region: "United States",
    description: "Daily mean temperature for the Houston energy and industrial region.",
    documentationUrl: "https://open-meteo.com/en/docs/historical-weather-api",
    config: { latitude: 29.7604, longitude: -95.3698, variable: "temperature_2m_mean", unit: "C", availabilityDelayDays: 5 },
  },
  {
    key: "usgs_potomac_discharge",
    provider: "USGS",
    name: "Potomac River daily discharge",
    category: "Water",
    region: "United States",
    description: "Daily mean discharge at USGS station 01646500 near Washington, D.C.",
    documentationUrl: "https://api.waterdata.usgs.gov/ogcapi/v0/collections/daily",
    config: { site: "01646500", parameter: "00060", unit: "ft3/s", availabilityDelayDays: 1 },
  },
  {
    key: "world_bank_us_electricity_use",
    provider: "WORLD_BANK",
    name: "United States electricity use per capita",
    category: "Energy",
    region: "United States",
    description: "Annual electric power consumption per capita from World Bank Open Data.",
    documentationUrl: "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392",
    config: { country: "USA", indicator: "EG.USE.ELEC.KH.PC", unit: "kWh per capita", availabilityDelayDays: 365 },
  },
  {
    key: "world_bank_us_shipping_connectivity",
    provider: "WORLD_BANK",
    name: "United States liner shipping connectivity",
    category: "Logistics",
    region: "United States",
    description: "Annual liner shipping connectivity index from World Bank Open Data.",
    documentationUrl: "https://data.worldbank.org/indicator/IS.SHP.GCNW.XQ",
    config: { country: "USA", indicator: "IS.SHP.GCNW.XQ", unit: "index", availabilityDelayDays: 365 },
  },
  {
    key: "world_bank_us_pm25",
    provider: "WORLD_BANK",
    name: "United States PM2.5 exposure",
    category: "Pollution",
    region: "United States",
    description: "Annual population-weighted ambient PM2.5 exposure from World Bank Open Data.",
    documentationUrl: "https://data.worldbank.org/indicator/EN.ATM.PM25.MC.M3",
    config: { country: "USA", indicator: "EN.ATM.PM25.MC.M3", unit: "micrograms per cubic meter", availabilityDelayDays: 365 },
  },
  {
    key: "world_bank_us_cereal_yield",
    provider: "WORLD_BANK",
    name: "United States cereal yield",
    category: "Agriculture",
    region: "United States",
    description: "Annual cereal yield measured in kilograms per hectare from World Bank Open Data.",
    documentationUrl: "https://data.worldbank.org/indicator/AG.YLD.CREL.KG",
    config: { country: "USA", indicator: "AG.YLD.CREL.KG", unit: "kg per hectare", availabilityDelayDays: 365 },
  },
  {
    key: "world_bank_us_rail_passengers",
    provider: "WORLD_BANK",
    name: "United States rail passenger activity",
    category: "Mobility",
    region: "United States",
    description: "Annual rail passenger-kilometers from World Bank Open Data.",
    documentationUrl: "https://data.worldbank.org/indicator/IS.RRS.PASG.KM",
    config: { country: "USA", indicator: "IS.RRS.PASG.KM", unit: "million passenger-km", availabilityDelayDays: 365 },
  },
  {
    key: "world_bank_us_household_consumption",
    provider: "WORLD_BANK",
    name: "United States household consumption",
    category: "Retail",
    region: "United States",
    description: "Annual household final consumption expenditure from World Bank Open Data.",
    documentationUrl: "https://data.worldbank.org/indicator/NE.CON.PRVT.CD",
    config: { country: "USA", indicator: "NE.CON.PRVT.CD", unit: "current USD", availabilityDelayDays: 365 },
  },
  {
    key: "world_bank_us_metals_exports",
    provider: "WORLD_BANK",
    name: "United States ores and metals exports",
    category: "Commodity infrastructure",
    region: "United States",
    description: "Annual ores and metals share of merchandise exports from World Bank Open Data.",
    documentationUrl: "https://data.worldbank.org/indicator/TX.VAL.MMTL.ZS.UN",
    config: { country: "USA", indicator: "TX.VAL.MMTL.ZS.UN", unit: "percent of merchandise exports", availabilityDelayDays: 365 },
  },
]);

export const MARKET_TARGETS = Object.freeze([
  { symbol: "BTC-USD", provider: "COINBASE", assetClass: "crypto", name: "Bitcoin / US dollar", configured: true },
  { symbol: "ETH-USD", provider: "COINBASE", assetClass: "crypto", name: "Ether / US dollar", configured: true },
  { symbol: "EURUSD", provider: "ECB", name: "Euro / US dollar", configured: true },
  { symbol: "EURGBP", provider: "ECB", name: "Euro / British pound", configured: true },
  { symbol: "EURJPY", provider: "ECB", name: "Euro / Japanese yen", configured: true },
  { symbol: "EURCHF", provider: "ECB", name: "Euro / Swiss franc", configured: true },
]);

function isoDay(value) {
  const time = Date.parse(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(time)) throw new Error("invalid_provider_timestamp");
  return new Date(time).toISOString();
}

function availableAfter(timestamp, days) {
  return new Date(Date.parse(timestamp) + Number(days) * DAY_MS).toISOString();
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseOpenMeteo(payload, variable, availabilityDelayDays = 5) {
  const dates = payload?.daily?.time;
  const values = payload?.daily?.[variable];
  if (!Array.isArray(dates) || !Array.isArray(values) || dates.length !== values.length) throw new Error("invalid_open_meteo_response");
  return dates.flatMap((date, index) => {
    const value = finite(values[index]);
    if (value === null) return [];
    const timestamp = isoDay(date);
    return [{ timestamp, value, availableAt: availableAfter(timestamp, availabilityDelayDays) }];
  });
}

export function parseUsgs(payload, availabilityDelayDays = 1) {
  if (Array.isArray(payload?.features)) {
    return payload.features.flatMap((feature) => {
      const properties = feature?.properties;
      const value = finite(properties?.value);
      if (value === null || !properties?.time) return [];
      const timestamp = isoDay(properties.time);
      return [{ timestamp, value, availableAt: availableAfter(timestamp, availabilityDelayDays) }];
    }).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }
  const series = payload?.value?.timeSeries;
  if (!Array.isArray(series)) throw new Error("invalid_usgs_response");
  const daily = new Map();
  for (const item of series) {
    for (const group of item?.values ?? []) {
      for (const observation of group?.value ?? []) {
        const value = finite(observation?.value);
        if (value === null || !Number.isFinite(Date.parse(observation?.dateTime))) continue;
        const timestamp = isoDay(observation.dateTime);
        const values = daily.get(timestamp) ?? [];
        values.push(value);
        daily.set(timestamp, values);
      }
    }
  }
  return [...daily.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([timestamp, values]) => ({
    timestamp,
    value: values.reduce((sum, value) => sum + value, 0) / values.length,
    availableAt: availableAfter(timestamp, availabilityDelayDays),
  }));
}

export function parseWorldBank(payload, availabilityDelayDays = 365) {
  const observations = payload?.[1];
  if (!Array.isArray(observations)) throw new Error("invalid_world_bank_response");
  return observations.flatMap((observation) => {
    const year = Number(observation?.date);
    const value = finite(observation?.value);
    if (!Number.isInteger(year) || year < 1900 || year > 2200 || value === null) return [];
    const timestamp = new Date(Date.UTC(year, 0, 1)).toISOString();
    return [{ timestamp, value, availableAt: availableAfter(timestamp, availabilityDelayDays) }];
  }).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(cell); cell = ""; }
    else cell += character;
  }
  cells.push(cell);
  return cells;
}

export function parseEcbCsv(csv) {
  const lines = String(csv).replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("invalid_ecb_response");
  const headers = parseCsvLine(lines.shift());
  const timeIndex = headers.indexOf("TIME_PERIOD");
  const valueIndex = headers.indexOf("OBS_VALUE");
  if (timeIndex < 0 || valueIndex < 0) throw new Error("invalid_ecb_response");
  return lines.flatMap((line) => {
    const columns = parseCsvLine(line);
    const price = finite(columns[valueIndex]);
    if (price === null) return [];
    return [{ timestamp: isoDay(columns[timeIndex]), price }];
  }).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function parseAlphaVantage(payload) {
  const series = payload?.["Time Series (Daily)"];
  if (!series || typeof series !== "object") {
    if (payload?.Information || payload?.Note || payload?.["Error Message"]) throw new Error("alpha_vantage_unavailable");
    throw new Error("invalid_alpha_vantage_response");
  }
  return Object.entries(series).flatMap(([date, values]) => {
    const price = finite(values?.["5. adjusted close"] ?? values?.["4. close"]);
    return price === null ? [] : [{ timestamp: isoDay(date), price }];
  }).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function parseCoinbaseCandles(payload) {
  if (!Array.isArray(payload)) throw new Error("invalid_coinbase_response");
  return payload.flatMap((candle) => {
    if (!Array.isArray(candle) || candle.length < 5 || !Number.isFinite(Number(candle[0]))) return [];
    // Coinbase candles are [time, low, high, open, close, volume].
    const price = finite(candle[4]);
    return price === null || price <= 0 ? [] : [{ timestamp: new Date(Number(candle[0]) * 1_000).toISOString(), price }];
  }).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function dateRange(years = 3, endDelayDays = 7) {
  const end = new Date(Date.now() - endDelayDays * DAY_MS);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function fetchJson(url, headers = {}) {
  const response = await fetchExternalText(url, { maxBytes: MAX_PROVIDER_BYTES, timeoutMs: 20_000, headers });
  try { return { response, payload: JSON.parse(response.text) }; }
  catch { throw new Error("invalid_provider_json"); }
}

export function sourceCatalog() {
  return SOURCE_CATALOG.map(({ config: _config, ...source }) => source);
}

export function targetCatalog() {
  const alphaConfigured = Boolean(process.env.ALPHA_VANTAGE_API_KEY);
  return [...MARKET_TARGETS, { symbol: "CUSTOM_EQUITY", provider: "ALPHA_VANTAGE", name: "US equity symbol", configured: alphaConfigured }];
}

export async function loadSourceDataset(catalogKey) {
  const source = SOURCE_CATALOG.find((entry) => entry.key === catalogKey);
  if (!source) throw new Error("unknown_provider_source");
  const { config } = source;
  let url;
  let rows;
  if (source.provider === "OPEN_METEO") {
    const range = dateRange(3, config.availabilityDelayDays);
    url = new URL("https://archive-api.open-meteo.com/v1/archive");
    for (const [key, value] of Object.entries({ latitude: config.latitude, longitude: config.longitude, start_date: range.start, end_date: range.end, daily: config.variable, timezone: "UTC" })) url.searchParams.set(key, value);
    const { payload } = await fetchJson(url);
    rows = parseOpenMeteo(payload, config.variable, config.availabilityDelayDays);
  } else if (source.provider === "USGS") {
    const range = dateRange(3, 1);
    url = new URL("https://api.waterdata.usgs.gov/ogcapi/v0/collections/daily/items");
    for (const [key, value] of Object.entries({ f: "json", monitoring_location_id: `USGS-${config.site}`, parameter_code: config.parameter, statistic_id: "00003", datetime: `${range.start}/${range.end}`, limit: "10000" })) url.searchParams.set(key, value);
    const { payload } = await fetchJson(url);
    rows = parseUsgs(payload, config.availabilityDelayDays);
  } else if (source.provider === "WORLD_BANK") {
    url = new URL(`https://api.worldbank.org/v2/country/${config.country}/indicator/${config.indicator}`);
    for (const [key, value] of Object.entries({ format: "json", per_page: "1000" })) url.searchParams.set(key, value);
    const { payload } = await fetchJson(url);
    rows = parseWorldBank(payload, config.availabilityDelayDays);
  }
  if (!rows?.length) throw new Error("provider_returned_no_rows");
  return { rows, provider: source.provider, catalogKey: source.key, unit: config.unit, sourceUrl: url.toString(), retrievedAt: new Date().toISOString() };
}

export async function loadMarketTarget(symbol, { equitySymbol } = {}) {
  if (["BTC-USD", "ETH-USD"].includes(symbol)) {
    // Coinbase permits up to 300 daily candles per unauthenticated request.
    const end = new Date();
    const start = new Date(end.getTime() - 299 * DAY_MS);
    const url = new URL(`https://api.exchange.coinbase.com/products/${symbol}/candles`);
    for (const [key, value] of Object.entries({ granularity: "86400", start: start.toISOString(), end: end.toISOString() })) url.searchParams.set(key, value);
    // Coinbase rejects requests without a descriptive user agent.
    const { payload } = await fetchJson(url, { "User-Agent": "QARAU-MVP/1.0" });
    const rows = parseCoinbaseCandles(payload);
    if (!rows.length) throw new Error("provider_returned_no_rows");
    return { rows, provider: "COINBASE", assetClass: "crypto", symbol, sourceUrl: url.toString(), retrievedAt: new Date().toISOString() };
  }
  const currency = { EURUSD: "USD", EURGBP: "GBP", EURJPY: "JPY", EURCHF: "CHF" }[symbol];
  if (currency) {
    const range = dateRange(4, 0);
    const url = new URL(`https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A`);
    for (const [key, value] of Object.entries({ startPeriod: range.start, endPeriod: range.end, format: "csvdata" })) url.searchParams.set(key, value);
    const response = await fetchExternalText(url, { maxBytes: MAX_PROVIDER_BYTES, timeoutMs: 20_000 });
    const rows = parseEcbCsv(response.text);
    if (!rows.length) throw new Error("provider_returned_no_rows");
    return { rows, provider: "ECB", assetClass: "fx", symbol, sourceUrl: url.toString(), retrievedAt: new Date().toISOString() };
  }
  if (symbol !== "CUSTOM_EQUITY") throw new Error("unknown_market_target");
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  const ticker = String(equitySymbol ?? "").trim().toUpperCase();
  if (!apiKey) throw new Error("alpha_vantage_key_required");
  if (!/^[A-Z0-9.-]{1,15}$/.test(ticker)) throw new Error("invalid_equity_symbol");
  const url = new URL("https://www.alphavantage.co/query");
  for (const [key, value] of Object.entries({ function: "TIME_SERIES_DAILY", symbol: ticker, outputsize: "full", apikey: apiKey })) url.searchParams.set(key, value);
  const { payload } = await fetchJson(url);
  const rows = parseAlphaVantage(payload);
  if (!rows.length) throw new Error("provider_returned_no_rows");
  return { rows, provider: "ALPHA_VANTAGE", symbol: ticker, sourceUrl: `${url.origin}${url.pathname}`, retrievedAt: new Date().toISOString() };
}
