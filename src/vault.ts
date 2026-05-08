import type { TenantContext } from "./tenant.ts";
import { AuthError } from "./errors.ts";
import { callRPC } from "./rpc-client.ts";

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { value: string; fetchedAt: number }>();

export async function getSecret(ctx: TenantContext, secretName: string): Promise<string> {
  const cached = cache.get(secretName);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.value;
  if (secretName === "internal_token" && typeof Deno !== "undefined") {
    const env = Deno.env.get("INTERNAL_TOKEN");
    if (env) { cache.set(secretName, { value: env, fetchedAt: Date.now() }); return env; }
  }
  try {
    const value = await callRPC<string>(ctx, "shared_get_vault_secret", { secret_name: secretName });
    if (typeof value !== "string" || !value) throw new AuthError(`secret_not_found: ${secretName}`);
    cache.set(secretName, { value, fetchedAt: Date.now() });
    return value;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError(`vault_read_failed: ${secretName}`);
  }
}

export function _clearCache(): void { cache.clear(); }
