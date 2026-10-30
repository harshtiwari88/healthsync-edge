export interface SafeJsonResult<T> {
  isJson: boolean;
  data: T | null;
  rawText: string;
}

export interface SafeFetchFallbackResult<T> {
  success: boolean;
  isDemoFallback: boolean;
  status: number;
  data: T;
  error?: string;
}

/**
 * Safely parses JSON strings inside a try-catch block with clean default fallbacks
 * (`[]` or `{}`), preventing corrupt storage payloads from crashing components.
 */
export function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as T;
    if (parsed === null || parsed === undefined) {
      return fallback;
    }
    if (Array.isArray(fallback) && !Array.isArray(parsed)) {
      return fallback;
    }
    if (
      typeof fallback === 'object' &&
      fallback !== null &&
      !Array.isArray(fallback) &&
      (typeof parsed !== 'object' || Array.isArray(parsed))
    ) {
      return fallback;
    }
    return parsed;
  } catch (err) {
    console.warn('[SwasthyaSetu Storage] Corrupt JSON detected; using safe default fallback:', err);
    return fallback;
  }
}

export function safeReadLocalStorage<T>(key: string, fallback: T): T {
  try {
    if (
      typeof globalThis === 'undefined' ||
      !('localStorage' in globalThis) ||
      !globalThis.localStorage
    ) {
      return fallback;
    }
    const raw = globalThis.localStorage.getItem(key);
    return safeParseJson<T>(raw, fallback);
  } catch {
    return fallback;
  }
}

export function safeWriteLocalStorage(key: string, value: unknown): boolean {
  try {
    if (
      typeof globalThis === 'undefined' ||
      !('localStorage' in globalThis) ||
      !globalThis.localStorage
    ) {
      return false;
    }
    globalThis.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function safeReadSessionStorage<T>(key: string, fallback: T): T {
  try {
    if (
      typeof globalThis === 'undefined' ||
      !('sessionStorage' in globalThis) ||
      !globalThis.sessionStorage
    ) {
      return fallback;
    }
    const raw = globalThis.sessionStorage.getItem(key);
    return safeParseJson<T>(raw, fallback);
  } catch {
    return fallback;
  }
}

export function safeWriteSessionStorage(key: string, value: unknown): boolean {
  try {
    if (
      typeof globalThis === 'undefined' ||
      !('sessionStorage' in globalThis) ||
      !globalThis.sessionStorage
    ) {
      return false;
    }
    globalThis.sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely reads and parses an HTTP Response body without ever throwing
 * `SyntaxError: Unexpected token ... is not valid JSON` when a proxy, CDN,
 * static host (e.g. Vercel "The page could not be found"), or gateway
 * returns plain text or HTML instead of JSON.
 */
export async function safeReadJson<T = Record<string, unknown>>(
  resp: Response
): Promise<SafeJsonResult<T>> {
  let rawText = '';
  try {
    rawText = await resp.text();
  } catch {
    return {isJson: false, data: null, rawText: ''};
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return {isJson: false, data: null, rawText};
  }

  const contentType = (resp.headers.get('content-type') || '').toLowerCase();
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!contentType.includes('application/json') && !looksLikeJson) {
    return {isJson: false, data: null, rawText};
  }

  try {
    const parsed = JSON.parse(trimmed) as T;
    return {isJson: true, data: parsed, rawText};
  } catch {
    return {isJson: false, data: null, rawText};
  }
}

/**
 * Detects when an API request hit a static host, missing serverless route,
 * SPA HTML fallback, or reverse-proxy gateway outage rather than our JSON API.
 */
export function isBackendUnavailableResponse<T>(
  resp: Response,
  parsed: SafeJsonResult<T>
): boolean {
  if (!parsed.isJson) {
    return true;
  }
  return resp.status === 502 || resp.status === 503 || resp.status === 504;
}

/**
 * Wraps `fetch()` with AbortController timeout and structured fallback handling so
 * missing environment keys or network timeouts log a clean `console.warn` and return
 * `{ success: true, isDemoFallback: true, data: fallbackData }` instead of throwing.
 */
export async function safeFetchWithFallback<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  fallbackData: T,
  timeoutMs = 12_000
): Promise<SafeFetchFallbackResult<T>> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller !== null && !init?.signal
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

  try {
    const resp = await fetch(input, {
      ...init,
      ...(controller && !init?.signal ? {signal: controller.signal} : {}),
    });
    const parsed = await safeReadJson<T & {isDemoFallback?: boolean; data?: T; error?: string}>(
      resp
    );

    if (!parsed.isJson || !parsed.data) {
      console.warn(
        `[SwasthyaSetu Fetch Fallback] Non-JSON response (${resp.status}) from ${String(input)}; returning fallback.`
      );
      return {
        success: true,
        isDemoFallback: true,
        status: resp.status,
        data: fallbackData,
      };
    }

    if (!resp.ok) {
      console.warn(
        `[SwasthyaSetu Fetch Fallback] HTTP ${resp.status} from ${String(input)}; returning fallback.`
      );
      return {
        success: true,
        isDemoFallback: true,
        status: resp.status,
        data: fallbackData,
        error: parsed.data.error,
      };
    }

    const unwrapped =
      parsed.data.data !== undefined && parsed.data.isDemoFallback !== undefined
        ? parsed.data.data
        : (parsed.data as T);

    return {
      success: true,
      isDemoFallback: Boolean(parsed.data.isDemoFallback),
      status: resp.status,
      data: unwrapped,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[SwasthyaSetu Fetch Fallback] Request to ${String(input)} failed (${msg}); returning fallback.`
    );
    return {
      success: true,
      isDemoFallback: true,
      status: 0,
      data: fallbackData,
      error: msg,
    };
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

