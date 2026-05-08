import "jsr:@supabase/functions-js@^2/edge-runtime.d.ts";
import {
  AuthError as _AuthError,
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
