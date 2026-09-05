const PERMANENT_ERRORS = new Set(["unknown_job_type", "unsupported_job_payload_version", "invalid_job_payload", "authorization_denied", "not_found"]);

export function retryDelaySeconds(attempt, { baseSeconds = 5, maximumSeconds = 3_600 } = {}) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("invalid_retry_attempt");
  if (!Number.isInteger(baseSeconds) || baseSeconds < 1 || !Number.isInteger(maximumSeconds) || maximumSeconds < baseSeconds) throw new Error("invalid_retry_policy");
  return Math.min(maximumSeconds, baseSeconds * (2 ** (attempt - 1)));
}

export function retryableError(errorCode) {
  return !PERMANENT_ERRORS.has(errorCode);
}
