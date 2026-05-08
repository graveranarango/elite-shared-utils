# @elite/shared-utils

Shared TypeScript/Deno utility module for Elite AI Broker Edge Functions.
Centralizes auth, RPC client, structured logging with PII sanitizer,
exponential-backoff retry, LLM cost tracking, and tenant context handling.

**Target runtime**: Deno 1.40+ (Supabase Edge Functions, local Deno).

## Install (JSR)

```ts
import { createContext, callRPC, logger, withRetry } from "jsr:@elite/shared-utils@^0.1.0";
```

## Modules

| Module | Exports |
|---|---|
| `tenant.ts` | `TenantContext`, `createContext()` |
| `errors.ts` | `EliteError`, `RPCError`, `AuthError`, `TenantError`, `RateLimitError`, `ValidationError`, `ExternalAPIError` |
| `logger.ts` | `logger.{debug,info,warn,error}`, `sanitize()` |
| `vault.ts` | `getSecret()` |
| `rpc-client.ts` | `callRPC()`, `RPCOptions` |
| `retry.ts` | `withRetry()`, `RetryOptions` |
| `cost.ts` | `trackLLMCost()`, `LLMCostInput` |
| `types.ts` | DB row interface stubs |

## Quickstart

```ts
import {
  createContext, callRPC, logger, withRetry, trackLLMCost, AuthError,
} from "jsr:@elite/shared-utils@^0.1.0";

const ctx = createContext({
  tenantId: req.headers.get("x-tenant-id")!,
  partnerId: req.headers.get("x-partner-id")!,
  requestId: req.headers.get("x-request-id") ?? undefined,
});

logger.info(ctx, "request received", { route: "/lia/inbound" });

const conv = await withRetry(ctx, () =>
  callRPC<{ id: string }>(ctx, "lia_get_or_create_conversation", {
    customer_id: customerId,
    channel: "whatsapp",
  })
);

await trackLLMCost(ctx, {
  provider: "anthropic", model: "sonnet-4-6",
  tokensIn: 1200, tokensOut: 350, costUsd: 0.0084,
  rpcName: "lia_save_message", conversationId: conv.id,
});
```

## Configuration (env vars)

| Var | Default |
|---|---|
| `ELITE_RPC_BRIDGE_URL` | `https://uoznkapeedqgoiwebete.functions.supabase.co/elite-rpc-bridge` |
| `INTERNAL_TOKEN` | required for `callRPC` and `getSecret('internal_token')` shortcut |

## PII sanitizer

`logger.*` automatically sanitizes string fields before emit:

| Pattern | Replaced with |
|---|---|
| Phone (E.164 / US formats) | `[PHONE]` |
| Email | `[EMAIL]` |
| SSN `xxx-xx-xxxx` | `[SSN]` |
| Credit card (13-16 digits) | `[CC]` |
| API keys (`sk_*`, `pk_*`, `sbp_*`, etc.) | `[API_KEY]` |

## Errors

All errors extend `EliteError` with discriminated `code`:

```ts
try {
  await callRPC(ctx, "x", {});
} catch (e) {
  if (e instanceof RateLimitError) console.log("retry after", e.retryAfter);
  else if (e instanceof AuthError) console.log("auth failed");
  else if (e instanceof ValidationError) console.log("bad arg", e.field);
}
```

## Retry

Default: 3 attempts, exponential 100→200→400ms with ±20% jitter.
Hard cap: 5 attempts (throws `config_error` above).
Retryable by default: `ExternalAPIError`, `RateLimitError`.
`RateLimitError.retryAfter` is honored when present.

## Cost tracking

`trackLLMCost` never throws — failures log a warning so cost-tracking outages
don't break user-facing flows.

## Development

```bash
deno task test          # run tests with coverage
deno task lint          # lint
deno task fmt:check     # format check
deno task publish:dry   # dry-run JSR publish
```

## CI / Publishing

- `.github/workflows/test.yml` runs `deno test` + lint + fmt on every PR.
- `.github/workflows/publish.yml` publishes to JSR on tag `v*`.

To publish manually:
```bash
deno publish
```
(requires JSR auth: `deno auth login` or GitHub OIDC via the workflow).

## Versioning

Semver. `0.1.0` is the initial unstable release; expect breaking changes
before `1.0.0`.
