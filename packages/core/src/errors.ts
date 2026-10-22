// Typed errors. Error bodies: `{code,msg}` on market data, `{error}` on marketStats/sparklines
// and the trade/user API (CLAUDE.md §4.3; strike-auth skill "Auth errors").

export class StrikeApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly code: string | undefined,
    readonly apiMessage: string,
    readonly body: unknown,
  ) {
    super(`Strike ${status} ${code ? code + " " : ""}${apiMessage} (${url})`);
    this.name = "StrikeApiError";
  }
  /** strike-auth "Handling 401s": only these two mean the key itself is invalid. */
  get keyInvalid(): boolean {
    return this.status === 401 && (this.apiMessage === "authentication failed" || this.apiMessage === "wallet expired or revoked");
  }
}

export class StrikeNetworkError extends Error {
  constructor(readonly url: string, cause: unknown) {
    super(`Network error calling ${url}: ${String(cause)}`);
    this.name = "StrikeNetworkError";
  }
}

export class StrikeSchemaError extends Error {
  constructor(readonly url: string, readonly issues: string) {
    super(`Unexpected response shape from ${url}: ${issues}`);
    this.name = "StrikeSchemaError";
  }
}

export class MissingKeysError extends Error {
  constructor() {
    super("API wallet keys are not configured (STRIKE_API_PUBLIC_KEY / STRIKE_API_PRIVATE_KEY)");
    this.name = "MissingKeysError";
  }
}

export function parseErrorBody(body: unknown): { code: string | undefined; message: string } {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.error === "string") return { code: undefined, message: b.error };
    if (typeof b.msg === "string") return { code: typeof b.code === "string" ? b.code : undefined, message: b.msg };
  }
  return { code: undefined, message: typeof body === "string" ? body.slice(0, 200) : "unknown error" };
}
