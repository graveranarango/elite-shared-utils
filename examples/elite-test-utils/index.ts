import "jsr:@supabase/functions-js@^2/edge-runtime.d.ts";
import {
  AuthError,
  callRPC,
  createContext,
  ExternalAPIError,
  getSecret,
  logger,
  RateLimitError as _RateLimitError,
  RPCError as _RPCError,
  sanitize,
  trackLLMCost as _trackLLMCost,
  ValidationError as _ValidationError,
  withRetry,
} from "jsr:@elite/shared-utils@^0.1.0";

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // Health
  if (req.method === "GET" || url.searchParams.get("health") === "1") {
    return new Response(
      JSON.stringify({
        status: "ok",
        module: "@elite/shared-utils",
        version: "0.1.0",
        exports: [
          "createContext",
          "logger",
          "sanitize",
          "withRetry",
          "callRPC",
          "trackLLMCost",
          "AuthError",
          "TenantError",
          "RateLimitError",
          "ValidationError",
          "RPCError",
          "ExternalAPIError",
        ],
      }),
      { headers: { "content-type": "application/json" } },
    );
  }

  // POST: smoke tests (no real DB calls; only library exercises)
  const ctx = createContext({
    tenantId: req.headers.get("x-tenant-id") ?? "a0000000-0000-0000-0000-000000000001",
    partnerId: req.headers.get("x-partner-id") ?? "00000000-0000-0000-0000-000000000001",
  });

  const results: Record<string, unknown> = {};

  // T8: logger.info captures into a snapshot via console.log monkey-patch
  let captured = "";
  const origLog = console.log;
  console.log = (s: string) => {
    captured = s;
  };
  try {
    logger.info(ctx, "smoke_t8", { route: "elite-test-utils" });
  } finally {
    console.log = origLog;
  }
  results.t8_logger_json = JSON.parse(captured);

  // T9: PII sanitization
  results.t9_pii = sanitize({
    phone: "+1 305 555 1234",
    email: "user@example.com",
    ssn: "123-45-6789",
    cc: "4111-1111-1111-1111",
    apikey: "sk_test_abcdefghij1234567890",
  });

  // T10: withRetry happy path
  let attempts = 0;
  // deno-lint-ignore require-await
  const retryResult = await withRetry(ctx, async () => {
    attempts++;
    if (attempts < 3) throw new ExternalAPIError("anthropic", 502, "transient");
    return "ok_3rd";
  }, { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 });
  results.t10_retry = { result: retryResult, attempts_used: attempts };

  // T6 + T7: vault + callRPC require live env (INTERNAL_TOKEN). Show signature only.
  results.t6_vault_export = typeof getSecret === "function";
  results.t7_callrpc_export = typeof callRPC === "function";

  // T11: live vault.getSecret end-to-end through bridge (M7-DEUDA1).
  // Requires INTERNAL_TOKEN env on the EF + TEST_SECRET in vault.
  const t11: Record<string, unknown> = {};
  try {
    const v = await getSecret(ctx, "TEST_SECRET");
    t11.test_secret_value = v;
    t11.test_secret_match = v === "test_value_xyz";
  } catch (e) {
    t11.test_secret_error = e instanceof Error ? e.message : String(e);
  }
  try {
    await getSecret(ctx, "nonexistent_secret_zzz");
    t11.nonexistent_threw_auth_error = false;
  } catch (e) {
    t11.nonexistent_threw_auth_error = e instanceof AuthError;
    t11.nonexistent_error_kind = e?.constructor?.name ?? "unknown";
  }
  results.t11_vault_live = t11;

  return new Response(
    JSON.stringify(
      {
        request_id: ctx.requestId,
        elapsed_ms: Date.now() - ctx.startedAt,
        results,
      },
      null,
      2,
    ),
    { headers: { "content-type": "application/json" } },
  );
});
