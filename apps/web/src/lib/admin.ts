import { getConfig } from "@/lib/env";

/**
 * Admin authorization. `allowDevBypass` is for READ-only handlers only (so a
 * local dev box without ADMIN_AUTH_SECRET can still view status). WRITE
 * handlers (feature-flag mutation, demo reset) must pass `false` so the dev
 * bypass can never authorize a destructive action.
 */
export function isAdmin(req: Request, opts: { allowDevBypass: boolean }): boolean {
  const config = getConfig();
  if (opts.allowDevBypass && config.nodeEnv !== "production" && config.adminAuthSecret === null) {
    return true;
  }
  if (config.adminAuthSecret === null) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token === config.adminAuthSecret;
}
