import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const ALLOWED_CONTENT_TYPES = /^(text\/(html|plain|csv)|application\/(json|xml))/i;

function privateIpv4(address) {
  const parts = address.split(".").map(Number);
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0);
}

function privateIpv6(address) {
  const value = address.toLowerCase();
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice(7);
    if (mapped.includes(".")) return privateIpv4(mapped);
    const parts = mapped.split(":");
    if (parts.length === 2 && parts.every((part) => /^[a-f0-9]{1,4}$/.test(part))) {
      const number = Number.parseInt(parts[0], 16) * 65_536 + Number.parseInt(parts[1], 16);
      return privateIpv4([number >>> 24, number >>> 16 & 255, number >>> 8 & 255, number & 255].join("."));
    }
  }
  return value === "::" || value === "::1" || value.startsWith("fc")
    || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9")
    || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("ff");
}

export function isPublicAddress(address) {
  const version = isIP(address);
  return version === 4 ? !privateIpv4(address) : version === 6 ? !privateIpv6(address) : false;
}

export function validateExternalUrl(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    throw new Error("invalid_url");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || hostname === "localhost") {
    throw new Error("unsafe_url");
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error("unsafe_url");
  return url;
}

export async function resolvePublicAddress(url) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return hostname;
  const answers = await lookup(hostname, { all: true, verbatim: true });
  if (answers.length === 0 || answers.some(({ address }) => !isPublicAddress(address))) throw new Error("unsafe_destination");
  return answers[0].address;
}

export function safeResponseHeaders(headers = {}) {
  const allowed = new Set(["content-type", "content-length", "etag", "last-modified", "cache-control"]);
  return Object.fromEntries(Object.entries(headers).flatMap(([name, value]) => {
    const normalized = name.toLowerCase();
    if (!allowed.has(normalized) || value === undefined) return [];
    return [[normalized, Array.isArray(value) ? value.join(", ") : String(value).slice(0, 1_024)]];
  }));
}

export async function requestExternalBytes(input, { maxBytes = 512_000, timeoutMs = 8_000, method = "GET", body, headers = {} } = {}) {
  const url = validateExternalUrl(input);
  const address = await resolvePublicAddress(url);
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const payload = body === undefined ? null : Buffer.from(String(body), "utf8");
  if (!/^(GET|POST)$/.test(method) || (payload && payload.length > 256_000)) throw new Error("invalid_external_request");
  const allowedHeaders = Object.fromEntries(Object.entries(headers).filter(([key]) => ["authorization", "content-type", "accept", "x-api-key", "user-agent"].includes(key.toLowerCase())));
  return new Promise((resolve, reject) => {
    const req = request({
      protocol: url.protocol,
      hostname: address,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      servername: url.hostname,
      headers: { Host: url.host, Accept: "text/html,text/plain,application/json,text/csv", ...allowedHeaders, ...(payload ? { "Content-Length": payload.length } : {}) },
      timeout: timeoutMs,
    }, (res) => {
      if ((res.statusCode ?? 500) >= 300 && (res.statusCode ?? 500) < 400) {
        res.resume();
        reject(new Error("redirect_blocked"));
        return;
      }
      if (res.statusCode === 429) {
        res.resume();
        const parsed = Number(res.headers["retry-after"] ?? 3_600);
        const error = new Error("external_rate_limited");
        error.retryAfterSeconds = Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, 3_600) : 3_600;
        reject(error);
        return;
      }
      const type = String(res.headers["content-type"] ?? "");
      const contentLength = Number(res.headers["content-length"] ?? 0);
      if ((res.statusCode ?? 500) >= 400 || !ALLOWED_CONTENT_TYPES.test(type)) {
        res.resume();
        reject(new Error("unsupported_response"));
        return;
      }
      if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maxBytes) {
        res.resume();
        reject(new Error("response_too_large"));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) req.destroy(new Error("response_too_large"));
        else chunks.push(chunk);
      });
      res.on("end", () => resolve({ url: url.toString(), contentType: type, headers: safeResponseHeaders(res.headers), bytes: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("fetch_timeout")));
    req.end(payload);
  });
}

export async function requestExternalText(input, options = {}) {
  const response = await requestExternalBytes(input, options);
  return { ...response, text: response.bytes.toString("utf8") };
}

export function fetchExternalText(input, options = {}) {
  return requestExternalText(input, options);
}
