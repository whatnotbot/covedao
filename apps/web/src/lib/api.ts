import { isProtocolError } from "@crclaunch/protocol";

/** Serialize bigint as strings for the JSON API (no JS floating point). */
function bigintToString(_key: string, value: any): any {
  return typeof value === "bigint" ? value.toString() : value;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, bigintToString), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function ok(data: unknown): Response {
  return json({ ok: true, data });
}

export function fail(
  code: string,
  message: string,
  status = 400,
  retryable = false,
): Response {
  return json({ ok: false, error: { code, message, retryable } }, status);
}

export function handleError(e: unknown): Response {
  console.error("[api] error:", e);
  if (isProtocolError(e)) {
    const status = e.code === "PROTOCOL_NOT_VERIFIED" ? 403 : 400;
    return fail(e.code, e.message, status, e.retryable);
  }
  if (e instanceof Error) {
    // Never expose stack traces.
    return fail("INTERNAL_ERROR", "An unexpected error occurred.", 500, true);
  }
  return fail("INTERNAL_ERROR", "An unexpected error occurred.", 500, true);
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
