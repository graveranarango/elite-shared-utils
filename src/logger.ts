import type { TenantContext } from "./tenant.ts";
export interface LogFields { [key: string]: unknown; }
type Level = "debug" | "info" | "warn" | "error";

const PHONE_RE = /\+?\d{1,2}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CC_RE = /\b(?:\d[ -]*?){13,16}\b/g;
const APIKEY_RE = /\b(sk|pk|rk|sbp|sbs|sb_)[_-][A-Za-z0-9_-]{16,}\b/g;

export function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(APIKEY_RE, "[API_KEY]")
      .replace(SSN_RE, "[SSN]")
      .replace(CC_RE, (m: string) => m.replace(/[^\d]/g, "").length >= 13 ? "[CC]" : m)
      .replace(PHONE_RE, "[PHONE]")
      .replace(EMAIL_RE, "[EMAIL]");
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitize(v);
    return out;
  }
  return value;
}

function emit(level: Level, ctx: TenantContext | null, msg: string, fields?: LogFields): void {
  const elapsed_ms = ctx ? Date.now() - ctx.startedAt : undefined;
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    request_id: ctx?.requestId ?? "unknown",
    tenant_id: ctx?.tenantId,
    partner_id: ctx?.partnerId,
    elapsed_ms,
    ...(fields ? (sanitize(fields) as LogFields) : {}),
  };
  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (ctx: TenantContext, msg: string, fields?: LogFields) => emit("debug", ctx, msg, fields),
  info:  (ctx: TenantContext, msg: string, fields?: LogFields) => emit("info",  ctx, msg, fields),
  warn:  (ctx: TenantContext, msg: string, fields?: LogFields) => emit("warn",  ctx, msg, fields),
  error: (ctx: TenantContext, msg: string, fields?: LogFields) => emit("error", ctx, msg, fields),
};
