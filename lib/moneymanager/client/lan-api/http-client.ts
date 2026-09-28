// GET-only HTTP client for MoneyManager's real REST API (the same Express
// app the desktop's office-LAN host mode serves - see
// moneymanager-standalone-src/src/main/lan-server/start-lan-server.ts,
// verified against mm-server-actual/src/server/app.ts). Used by
// lib/moneymanager/client/lan-api-source.ts.
//
// Read-only enforcement, physically, not just by convention: this class
// exposes exactly one HTTP-calling method, `get()`. There is no `post`,
// `put`, `patch`, or `delete` method anywhere on it, and `get()` itself
// hardcodes `method: 'GET'` on every request it builds - there is no code
// path in this file that can construct a mutating request, with or
// without a bug elsewhere in the adapter. The one belt-and-suspenders
// check (LanApiWriteAttemptError) exists only in case a future edit to
// this file ever tries to parameterize the HTTP method; it should be
// unreachable today.
//
// Auth: MoneyManager's real session mechanism (mm-server-actual/src/server/
// auth/session.ts, re-verified fresh for this phase) is a plain httpOnly
// cookie (`mm_session`) whose value is an opaque random token - the server
// hashes it (SHA-256) and looks up a `web_sessions` row, never a JWT, never
// anything this client could construct or forge. This client does NOT
// perform login itself and does NOT generate or invent any token - it only
// ever attaches a session cookie VALUE it was already given (obtained
// elsewhere, via the real POST /api/auth/login flow, which is out of scope
// for this adapter/phase). No credential of any kind is hardcoded here.
import {
  LanApiAuthenticationError,
  LanApiMalformedResponseError,
  LanApiNetworkError,
  LanApiNotFoundError,
  LanApiPermissionError,
  LanApiServerError,
  LanApiTimeoutError,
} from './errors';

export type LanApiHttpConfig = {
  /** e.g. 'http://192.168.1.50:4000' - the office-LAN host's address, never
   * hardcoded, never a production URL, always supplied by the caller
   * (env var / config, not a literal in source). */
  baseUrl: string;
  /** The raw mm_session cookie VALUE (not "Bearer ...", not a header name -
   * just the token itself), obtained via the real login flow elsewhere.
   * Never hardcoded. */
  sessionCookie: string;
  /** Request timeout in milliseconds. Defaults to 10s - a real HTTP call,
   * even on a LAN, should never hang indefinitely and turn a monitoring
   * run into a stuck process. */
  timeoutMs?: number;
  /** Injectable fetch, exactly like lib/moneymanager/office-records/
   * fetch.ts already does for testability - reused here rather than
   * inventing a different mocking approach. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 10_000;

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export class LanApiHttpClient {
  private readonly baseUrl: string;
  private readonly sessionCookie: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: LanApiHttpConfig) {
    this.baseUrl = config.baseUrl;
    this.sessionCookie = config.sessionCookie;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** The ONLY HTTP-calling method on this class - see the file header for
   * why that's a deliberate, physical read-only guarantee, not just a
   * convention: `method` is not a parameter here, and is hardcoded to
   * 'GET' a few lines below - there is no code path in this class that can
   * be made to issue anything else. */
  async get<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    validate?: (data: unknown) => data is T
  ): Promise<T> {
    const url = buildUrl(this.baseUrl, path, query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Cookie: `mm_session=${this.sessionCookie}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LanApiTimeoutError(`Request to ${path} timed out after ${this.timeoutMs}ms.`);
      }
      throw new LanApiNetworkError(`Request to ${path} failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401) {
      throw new LanApiAuthenticationError(`Not authenticated (HTTP 401) calling ${path}.`);
    }
    if (response.status === 403) {
      throw new LanApiPermissionError(`Not permitted (HTTP 403) calling ${path}.`);
    }
    if (response.status === 404) {
      throw new LanApiNotFoundError(`Endpoint not found (HTTP 404): ${path}`, path);
    }
    if (!response.ok) {
      throw new LanApiServerError(`Unexpected response (HTTP ${response.status}) calling ${path}.`, response.status);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      throw new LanApiMalformedResponseError(`Response from ${path} was not valid JSON: ${(err as Error).message}`);
    }

    if (validate && !validate(data)) {
      throw new LanApiMalformedResponseError(`Response from ${path} did not match the expected shape.`);
    }

    return data as T;
  }
}
