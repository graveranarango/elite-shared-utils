import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createContext } from "../src/tenant.ts";
import {
  AuthError,
  ExternalAPIError,
  RateLimitError,
  RPCError,
  TenantError,
  ValidationError,
} from "../src/errors.ts";
import { logger, sanitize } from "../src/logger.ts";
import { withRetry } from "../src/retry.ts";
import { _clearCache } from "../src/vault.ts";

const TENANT = "a0000000-0000-0000-0000-000000000001";
const PARTNER = "00000000-0000-0000-0000-000000000001";
const newCtx = () => createContext({ tenantId: TENANT, partnerId: PARTNER });

// --------- tenant ---------
Deno.test("tenant T1 happy: createContext returns valid ctx", () => {
  const c = createContext({ tenantId: TENANT, partnerId: PARTNER });
  assertEquals(c.tenantId, TENANT);
  assertEquals(c.partnerId, PARTNER);
  assert(c.requestId.length === 36);
  assert(typeof c.startedAt === "number");
});

Deno.test("tenant T2 error: invalid UUID throws TenantError", () => {
  assertThrows(() => createContext({ tenantId: "not-uuid", partnerId: PARTNER }), TenantError);
});

Deno.test("tenant T3 edge: requestId provided is preserved", () => {
  const rid = "11111111-1111-1111-1111-111111111111";
  const c = createContext({ tenantId: TENANT, partnerId: PARTNER, requestId: rid });
  assertEquals(c.requestId, rid);
});

// --------- errors ---------
Deno.test("errors T1: codes are discriminated", () => {
  assertEquals(new AuthError("x").code, "auth_error");
  assertEquals(new TenantError("x").code, "tenant_error");
  assertEquals(new ValidationError("f", "x").code, "validation_error");
  assertEquals(new RateLimitError(60, "x").code, "rate_limit_error");
  assertEquals(new RPCError("rpc", 500, "x").code, "rpc_error");
  assertEquals(new ExternalAPIError("anthropic", 502, "x").code, "external_api_error");
});

Deno.test("errors T2: RateLimitError carries retryAfter", () => {
  const e = new RateLimitError(120, "rate limited");
  assertEquals(e.retryAfter, 120);
});

Deno.test("errors T3: requestId propagates", () => {
  const e = new RPCError("rpc", 500, "x", "req-1");
  assertEquals(e.requestId, "req-1");
});

// --------- logger / sanitize ---------
Deno.test("logger T1 happy: emits JSON line with required fields", () => {
  const orig = console.log;
  let captured = "";
  console.log = (s: string) => {
    captured = s;
  };
  try {
    logger.info(newCtx(), "test msg", { foo: "bar" });
    const obj = JSON.parse(captured);
    assertEquals(obj.level, "info");
    assertEquals(obj.msg, "test msg");
    assertEquals(obj.foo, "bar");
    assertEquals(typeof obj.request_id, "string");
    assertEquals(obj.tenant_id, TENANT);
  } finally {
    console.log = orig;
  }
});

Deno.test("logger T2 PII: phone/email/SSN/CC/api_key sanitized", () => {
  const out = sanitize({
    phone: "+1 305 555 1234",
    email: "user@example.com",
    ssn: "123-45-6789",
    cc: "4111-1111-1111-1111",
    apikey: "sk_test_abcdefghij1234567890",
    nested: { phone: "305-555-9876" },
  }) as Record<string, unknown>;
  assertEquals(out.phone, "[PHONE]");
  assertEquals(out.email, "[EMAIL]");
  assertEquals(out.ssn, "[SSN]");
  assertEquals(out.cc, "[CC]");
  assertStringIncludes(String(out.apikey), "[API_KEY]");
  assertEquals((out.nested as Record<string, unknown>).phone, "[PHONE]");
});

Deno.test("logger T3 edge: non-string fields pass through", () => {
  const out = sanitize({ n: 42, b: true, nul: null, arr: [1, "+13055551234", 3] }) as Record<
    string,
    unknown
  >;
  assertEquals(out.n, 42);
  assertEquals(out.b, true);
  assertEquals(out.nul, null);
  assertEquals((out.arr as unknown[])[1], "[PHONE]");
});

// --------- retry ---------
Deno.test("retry T1 happy: fail 2x succeed 3rd", async () => {
  let calls = 0;
  // deno-lint-ignore require-await
  const result = await withRetry(newCtx(), async () => {
    calls++;
    if (calls < 3) throw new ExternalAPIError("anthropic", 502, "transient");
    return "ok";
  }, { attempts: 3, baseDelayMs: 1, maxDelayMs: 10 });
  assertEquals(result, "ok");
  assertEquals(calls, 3);
});

Deno.test("retry T2 error: non-retryable throws immediately", async () => {
  let calls = 0;
  await assertRejects(async () => {
    // deno-lint-ignore require-await
    await withRetry(newCtx(), async () => {
      calls++;
      throw new ValidationError("f", "bad input");
    }, { attempts: 5, baseDelayMs: 1 });
  }, ValidationError);
  assertEquals(calls, 1);
});

Deno.test("retry T3 edge: attempts > 5 throws config error", async () => {
  await assertRejects(
    // deno-lint-ignore require-await
    async () => await withRetry(newCtx(), async () => "x", { attempts: 6 }),
    Error,
    "config_error",
  );
});

Deno.test("retry T4 RateLimit: uses retryAfter when present", async () => {
  let calls = 0;
  let sawDelay = 0;
  const orig = setTimeout;
  // patch setTimeout to capture delay
  (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout =
    ((fn: () => void, ms?: number) => {
      sawDelay = ms ?? 0;
      return orig(fn, 0);
    }) as typeof setTimeout;
  try {
    // deno-lint-ignore require-await
    await withRetry(newCtx(), async () => {
      calls++;
      if (calls < 2) throw new RateLimitError(2, "slow down");
      return "ok";
    }, { attempts: 2, baseDelayMs: 1 });
  } finally {
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = orig;
  }
  assertEquals(sawDelay, 2000);
});

// --------- vault ---------
Deno.test("vault T1 happy: env INTERNAL_TOKEN shortcut returns directly", async () => {
  _clearCache();
  Deno.env.set("INTERNAL_TOKEN", "env_token_xyz_123");
  const origFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (() => {
    fetchCalled = true;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    const { getSecret } = await import("../src/vault.ts");
    const v = await getSecret(newCtx(), "internal_token");
    assertEquals(v, "env_token_xyz_123");
    assertEquals(fetchCalled, false, "env shortcut should not call fetch");
    // second call hits cache
    const v2 = await getSecret(newCtx(), "internal_token");
    assertEquals(v2, "env_token_xyz_123");
  } finally {
    globalThis.fetch = origFetch;
    Deno.env.delete("INTERNAL_TOKEN");
    _clearCache();
  }
});

Deno.test("vault T2 happy: fetch returns value, second call cached", async () => {
  _clearCache();
  Deno.env.set("INTERNAL_TOKEN", "fetch_caller_token_must_be_set_for_callRPC");
  let fetchCount = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCount++;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          request_id: "rid",
          rpc_name: "shared_get_vault_secret",
          result: "vault_value_abc",
          latency_ms: 5,
          sandbox: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;
  try {
    const { getSecret } = await import("../src/vault.ts");
    const v1 = await getSecret(newCtx(), "stripe_secret_key");
    assertEquals(v1, "vault_value_abc");
    assertEquals(fetchCount, 1);
    const v2 = await getSecret(newCtx(), "stripe_secret_key");
    assertEquals(v2, "vault_value_abc");
    assertEquals(fetchCount, 1, "cache hit, no extra fetch");
  } finally {
    globalThis.fetch = origFetch;
    Deno.env.delete("INTERNAL_TOKEN");
    _clearCache();
  }
});

Deno.test("vault T3 edge: secret not found throws AuthError", async () => {
  _clearCache();
  Deno.env.set("INTERNAL_TOKEN", "any");
  const origFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          request_id: "rid",
          rpc_name: "shared_get_vault_secret",
          result: null,
          latency_ms: 5,
          sandbox: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )) as typeof fetch;
  try {
    const { getSecret } = await import("../src/vault.ts");
    await assertRejects(
      async () => await getSecret(newCtx(), "missing_secret"),
      AuthError,
    );
  } finally {
    globalThis.fetch = origFetch;
    Deno.env.delete("INTERNAL_TOKEN");
    _clearCache();
  }
});

Deno.test("vault T4 edge: _clearCache works", () => {
  _clearCache();
  assertEquals(_clearCache(), undefined);
});

// --------- rpc-client mocked ---------
Deno.test("rpc T1 happy: 200 returns result", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          request_id: "rid-1",
          rpc_name: "shared_log_cost",
          result: { cost_id: 99 },
          latency_ms: 12,
          sandbox: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )) as typeof fetch;
  try {
    const { callRPC } = await import("../src/rpc-client.ts");
    const r = await callRPC<{ cost_id: number }>(newCtx(), "shared_log_cost", {
      service: "anthropic",
      cost_usd: 0.01,
    });
    assertEquals(r.cost_id, 99);
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("rpc T2 error: 429 throws RateLimitError with retryAfter", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ error_code: "rate_limited", error_message: "exceeded" }),
        { status: 429, headers: { "content-type": "application/json", "retry-after": "30" } },
      ),
    )) as typeof fetch;
  try {
    const { callRPC } = await import("../src/rpc-client.ts");
    await assertRejects(
      async () => await callRPC(newCtx(), "x", {}),
      RateLimitError,
    );
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("rpc T3 edge: 401 throws AuthError", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ error_code: "invalid_internal_token", error_message: "denied" }),
        { status: 401 },
      ),
    )) as typeof fetch;
  try {
    const { callRPC } = await import("../src/rpc-client.ts");
    await assertRejects(async () => await callRPC(newCtx(), "x", {}), AuthError);
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("rpc T4 edge: timeout aborts request", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }
      // never resolve otherwise
    });
  }) as typeof fetch;
  try {
    const { callRPC } = await import("../src/rpc-client.ts");
    await assertRejects(
      async () => await callRPC(newCtx(), "x", {}, { timeout: 30 }),
    );
  } finally {
    globalThis.fetch = orig;
  }
});

// --------- logger: cover error + debug levels ---------
Deno.test("logger T4 error level: emits with level=error", () => {
  const orig = console.log;
  let captured = "";
  console.log = (s: string) => {
    captured = s;
  };
  try {
    logger.error(newCtx(), "boom", { code: "x" });
    const obj = JSON.parse(captured);
    assertEquals(obj.level, "error");
    assertEquals(obj.msg, "boom");
    assertEquals(obj.code, "x");
  } finally {
    console.log = orig;
  }
});

Deno.test("logger T5 debug + warn levels: emit correctly", () => {
  const orig = console.log;
  const captured: string[] = [];
  console.log = (s: string) => {
    captured.push(s);
  };
  try {
    logger.debug(newCtx(), "dbg msg");
    logger.warn(newCtx(), "warn msg");
    const debugObj = JSON.parse(captured[0]);
    const warnObj = JSON.parse(captured[1]);
    assertEquals(debugObj.level, "debug");
    assertEquals(warnObj.level, "warn");
  } finally {
    console.log = orig;
  }
});
