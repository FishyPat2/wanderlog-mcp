import { WanderlogValidationError } from "./errors.js";

export type Config = {
  cookieHeader: string;
  baseUrl: string;
  wsBaseUrl: string;
  userAgent: string;
  defaultCurrency?: string;
};

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

/**
 * Normalizes a cookie value into a valid Cookie header.
 *
 * Accepts:
 *   - `s%3A...`                           → wraps as `connect.sid=s%3A...`
 *   - `connect.sid=s%3A...`               → passes through
 *   - `connect.sid=s%3A...; other=x`      → passes through
 *
 * Rejects empty strings and obviously malformed values.
 */
export function normalizeCookie(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new WanderlogValidationError(
      "WANDERLOG_COOKIE is empty",
      "Set WANDERLOG_COOKIE to the connect.sid cookie value from wanderlog.com.",
    );
  }

  if (/[\r\n\0]/.test(trimmed)) {
    throw new WanderlogValidationError("WANDERLOG_COOKIE contains invalid control characters");
  }

  if (/(?:^|;\s*)connect\.sid=[^;\s]+/.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("s%3A") || trimmed.startsWith("s:")) {
    return `connect.sid=${trimmed}`;
  }

  throw new WanderlogValidationError(
    "WANDERLOG_COOKIE does not look like a connect.sid cookie",
    "Expected a value starting with 's%3A' or 'connect.sid=s%3A'. Copy the exact value from DevTools → Application → Cookies → wanderlog.com → connect.sid.",
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = env.WANDERLOG_COOKIE;
  if (!raw) {
    throw new WanderlogValidationError(
      "WANDERLOG_COOKIE environment variable is not set",
      "Set WANDERLOG_COOKIE in your MCP config. See README for how to capture the cookie.",
    );
  }

  return {
    cookieHeader: normalizeCookie(raw),
    baseUrl: env.WANDERLOG_BASE_URL ?? "https://wanderlog.com",
    wsBaseUrl: env.WANDERLOG_WS_BASE_URL ?? "wss://wanderlog.com",
    userAgent: env.WANDERLOG_USER_AGENT ?? DEFAULT_USER_AGENT,
    defaultCurrency: env.WANDERLOG_DEFAULT_CURRENCY,
  };
}

/** Remove session credentials even when an upstream error echoes a decoded cookie. */
export function redactCredentials(text: string, cookieHeader: string): string {
  text = String(text);
  if (!cookieHeader) return text;
  const session = cookieHeader.match(/(?:^|;\s*)connect\.sid=([^;\s]+)/)?.[1];
  // Auxiliary cookies may be ordinary values such as "1"; replacing them corrupts data.
  const secrets = [cookieHeader, ...(session ? [session] : [])];
  for (const value of [...secrets]) {
    try {
      secrets.push(decodeURIComponent(value));
    } catch {
      /* Keep the original for malformed encodings. */
    }
  }
  for (const value of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(value).join("[REDACTED]");
  }
  return text;
}
