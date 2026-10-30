export interface SafeJsonResult<T> {
  isJson: boolean;
  data: T | null;
  rawText: string;
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
