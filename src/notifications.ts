// notifications.ts — sendEmail (Resend) + sendSMS (Twilio).
// v0.2.0 addition. No-throw on failure; returns delivery status for the caller
// to log. Designed for fire-and-forget alert pipelines (e.g. M12 budget-monitor).

import type { TenantContext } from "./tenant.ts";
import { getSecret } from "./vault.ts";

export type DeliveryStatus = "sent" | "mocked" | "failed";

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  html?: string;
  from?: string;
}

export interface SendEmailResult {
  status: DeliveryStatus;
  provider_id?: string;
  error?: string;
}

export interface SendSMSParams {
  to: string;
  body: string;
  from?: string;
  prefix?: string;
}

export interface SendSMSResult {
  status: DeliveryStatus;
  provider_id?: string;
  error?: string;
}

/**
 * Send an email via Resend. Looks up the API key from Vault under
 * `resend_api_key__<tenant_slug>`. If absent, returns `{ status: "mocked" }`.
 */
export async function sendEmail(
  ctx: TenantContext,
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const slug = tenantSlug(ctx.tenantId);
  const apiKey = await safeGetSecret(ctx, `resend_api_key__${slug}`);
  if (!apiKey) return { status: "mocked", error: `no resend_api_key__${slug} in vault` };

  const from = params.from ?? "alerts@eliteaibroker.com";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.body,
        ...(params.html ? { html: params.html } : {}),
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "<no body>");
      return { status: "failed", error: `resend ${res.status}: ${errText.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => null) as { id?: string } | null;
    return { status: "sent", provider_id: data?.id };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Send an SMS via Twilio. Looks up Account SID + Auth Token from Vault under
 * `twilio_account_sid__<tenant_slug>` + `twilio_auth_token__<tenant_slug>`.
 * If either is absent, returns `{ status: "mocked" }`.
 *
 * Default sender +17869819157 (M9 Elite line, A2P-approved).
 */
export async function sendSMS(ctx: TenantContext, params: SendSMSParams): Promise<SendSMSResult> {
  const slug = tenantSlug(ctx.tenantId);
  const sid = await safeGetSecret(ctx, `twilio_account_sid__${slug}`);
  const token = await safeGetSecret(ctx, `twilio_auth_token__${slug}`);
  if (!sid || !token) {
    return { status: "mocked", error: `no twilio creds in vault for ${slug}` };
  }

  const from = params.from ?? "+17869819157";
  const body = params.prefix ? `${params.prefix} ${params.body}` : params.body;

  try {
    const auth = btoa(`${sid}:${token}`);
    const formData = new URLSearchParams();
    formData.set("From", from);
    formData.set("To", params.to);
    formData.set("Body", body);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "<no body>");
      return { status: "failed", error: `twilio ${res.status}: ${errText.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => null) as { sid?: string } | null;
    return { status: "sent", provider_id: data?.sid };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── helpers ─────────────────────────────────────────────────────────

function tenantSlug(tenantId: string): string {
  if (tenantId === "a0000000-0000-0000-0000-000000000001") return "miami";
  return tenantId.slice(0, 8);
}

async function safeGetSecret(ctx: TenantContext, name: string): Promise<string | null> {
  try {
    const v = await getSecret(ctx, name);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}
