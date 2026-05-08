import type { TenantContext } from "./tenant.ts";
import { AuthError, RateLimitError, RPCError, TenantError, ValidationError } from "./errors.ts";

export interface RPCOptions {
  testMode?: boolean;
  timeout?: number;
}

const BRIDGE_URL =
  (typeof Deno !== "undefined" ? Deno.env.get("ELITE_RPC_BRIDGE_URL") : undefined) ??
    "https://uoznkapeedqgoiwebete.functions.supabase.co/elite-rpc-bridge";
const INTERNAL_TOKEN = (typeof Deno !== "undefined" ? Deno.env.get("INTERNAL_TOKEN") : undefined) ??
  "";

export async function callRPC<T = unknown>(
  ctx: TenantContext,
  rpcName: string,
  args: Record<string, unknown>,
  options: RPCOptions = {},
): Promise<T> {
  const timeout = options.timeout ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers: Record<string, string> = {
      "X-Internal-Token": INTERNAL_TOKEN,
      "X-Tenant-Id": ctx.tenantId,
      "X-Partner-Id": ctx.partnerId,
      "X-Request-Id": ctx.requestId,
      "Content-Type": "application/json",
    };
    if (options.testMode) headers["X-Test-Mode"] = "true";
    const res = await fetch(BRIDGE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ rpc_name: rpcName, args }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    const requestId = body.request_id ?? ctx.requestId;
    if (res.ok) return body.result as T;
    const code = body.error_code ?? "unknown_error";
    const msg = body.error_message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new AuthError(`${code}: ${msg}`, requestId);
    if (res.status === 403) throw new TenantError(`${code}: ${msg}`, requestId);
    if (res.status === 400 && code === "validation_failed") {
      throw new ValidationError("args", `${code}: ${msg}`, requestId);
    }
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "60", 10);
      throw new RateLimitError(retryAfter, `${code}: ${msg}`, requestId);
    }
    throw new RPCError(rpcName, res.status, `${code}: ${msg}`, requestId);
  } finally {
    clearTimeout(timer);
  }
}
