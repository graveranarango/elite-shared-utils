import { TenantError } from "./errors.ts";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface TenantContext {
  tenantId: string;
  partnerId: string;
  requestId: string;
  startedAt: number;
}
export function createContext(
  input: { tenantId: string; partnerId: string; requestId?: string },
): TenantContext {
  if (!UUID_RE.test(input.tenantId)) throw new TenantError(`invalid tenantId: ${input.tenantId}`);
  if (!UUID_RE.test(input.partnerId)) {
    throw new TenantError(`invalid partnerId: ${input.partnerId}`);
  }
  const requestId = input.requestId ?? crypto.randomUUID();
  return { tenantId: input.tenantId, partnerId: input.partnerId, requestId, startedAt: Date.now() };
}
