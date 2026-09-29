const TRAILING_SLASH = /\/+$/;

/**
 * The single egress point to the isolated publisher signer. Chain handlers must
 * not build this request themselves: the token header, the bounded timeout and
 * the failure shape are part of the key boundary, not of any one handler.
 */
export async function callPublisherSigner({ url, token, action, body, fetchImpl = fetch, timeoutMs = 60_000 }) {
  if (!url || !token || !action) throw new Error("publisher_signer_not_configured");
  const response = await fetchImpl(`${url.replace(TRAILING_SLASH, "")}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-publisher-token": token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { ok: response.ok, payload: await response.json() };
}

export function publisherSignerError(payload) {
  return new Error(payload?.error ?? "publisher_signer_failed");
}
