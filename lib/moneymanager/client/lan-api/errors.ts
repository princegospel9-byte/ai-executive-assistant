// Distinct, typed outcomes for the LAN API adapter (lib/moneymanager/client/
// lan-api-source.ts). Deliberately NOT collapsed into one generic "fetch
// failed" error - run.ts's fail-safe handling (Phase 3) needs to be able to
// tell these apart, and a human debugging a real connection needs to know
// which of these actually happened rather than "something went wrong".
export class LanApiError extends Error {}

/** The session cookie was missing, expired, or the server no longer
 * recognizes it (HTTP 401). Distinct from a permission problem - the
 * agent isn't logged in at all (or isn't logged in anymore), not "logged
 * in but not allowed". */
export class LanApiAuthenticationError extends LanApiError {}

/** The session is valid but the account it belongs to lacks the specific
 * permission the endpoint requires (HTTP 403) - e.g. a read-only role
 * missing PASSBOOK_CHECK_MANAGE. This is the CORRECT, expected outcome for
 * a genuinely read-only role calling an endpoint gated by a mixed
 * read+write permission (see fieldSurveyChecks()/passbookChecks()'s doc
 * comments on lan-api-source.ts) - it must surface distinctly, not be
 * treated as a connection failure or silently retried. */
export class LanApiPermissionError extends LanApiError {}

/** The endpoint itself doesn't exist at this URL (HTTP 404) - e.g. a typo
 * in the path, or the MoneyManager version behind this LAN server doesn't
 * have this route. Distinct from a permission problem or a server crash. */
export class LanApiNotFoundError extends LanApiError {
  constructor(message: string, readonly path: string) {
    super(message);
  }
}

/** The server responded but with an unexpected non-2xx, non-401/403/404
 * status (typically 5xx) - a real server-side problem, not a client
 * mistake. */
export class LanApiServerError extends LanApiError {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** The request was aborted because it exceeded its configured timeout -
 * distinct from a network error: the request may have reached the server
 * and just taken too long, or the server/network is unreachable and
 * hanging rather than actively refusing. Either way, this is NOT the same
 * as "the server said no" (401/403/404/5xx) - it's "we gave up waiting". */
export class LanApiTimeoutError extends LanApiError {}

/** fetch() itself threw for a reason other than our own timeout abort -
 * DNS failure, connection refused, TLS error, etc. The request never got a
 * response from the server at all. */
export class LanApiNetworkError extends LanApiError {}

/** The server responded with a 2xx status but the body wasn't valid JSON,
 * or didn't match the shape this method expects (e.g. missing an expected
 * field). Never silently coerced into an empty/default value - a
 * malformed response is exactly the kind of "we don't actually know what
 * happened" case the whole monitoring engine's fail-safe contract exists
 * to catch, not paper over. */
export class LanApiMalformedResponseError extends LanApiError {}

/** This MoneyManagerSource method cannot be faithfully implemented against
 * the current MoneyManager REST API surface - not a bug, a real, confirmed
 * gap (see lan-api-source.ts's per-method doc comments for exactly why:
 * usually "no bulk-read endpoint exists for this table", occasionally "the
 * endpoint exists but omits a field this method's contract requires").
 * Thrown deliberately rather than returning an empty array, which would
 * look exactly like "checked, found nothing" to every rule and to
 * run.ts's fail-safe handling - that distinction matters enormously for a
 * monitoring engine whose entire purpose is to never let "we didn't check"
 * look like "we checked and it's clean". */
export class LanApiUnsupportedMethodError extends LanApiError {}

/** Defensive, should be unreachable in normal use: thrown if anything ever
 * tries to make this client issue a non-GET request. See http-client.ts's
 * header comment for why the client physically only exposes a `get()`
 * method - this error exists only as a belt-and-suspenders check inside
 * that method itself. */
export class LanApiWriteAttemptError extends LanApiError {}
