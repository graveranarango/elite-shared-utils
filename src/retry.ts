import type { TenantContext } from "./tenant.ts";
import { logger } from "./logger.ts";
import { ExternalAPIError, RateLimitError, ValidationError } from "./errors.ts";

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryableErrors?: (e: Error) => boolean;
}

const MAX_ATTEMPTS_HARD = 5;
const defaultRetryable = (e: Error): boolean =>
  e instanceof ExternalAPIError || e instanceof RateLimitError;
const jitter = (d: number): number => Math.round(d * (0.8 + Math.random() * 0.4));

export async function withRetry<T>(
  ctx: TenantContext,
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  if (attempts > MAX_ATTEMPTS_HARD) {
    throw new Error(`config_error: attempts=${attempts} exceeds hard cap ${MAX_ATTEMPTS_HARD}`);
  }
  if (attempts < 1) throw new Error("config_error: attempts must be >= 1");
  const base = options.baseDelayMs ?? 100;
  const max = options.maxDelayMs ?? 2000;
  const isRetryable = options.retryableErrors ?? defaultRetryable;
  let lastErr: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const err = e as Error;
      lastErr = err;
      const last = i === attempts - 1;
      if (last || !isRetryable(err) || err instanceof ValidationError) throw err;
      let delay = jitter(Math.min(base * 2 ** i, max));
      if (err instanceof RateLimitError && err.retryAfter > 0) delay = err.retryAfter * 1000;
      logger.warn(ctx, "withRetry retrying", {
        attempt: i + 1,
        of: attempts,
        delay_ms: delay,
        error: err.message,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
