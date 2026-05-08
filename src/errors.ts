export abstract class EliteError extends Error {
  abstract readonly code: string;
  readonly requestId?: string;
  constructor(message: string, requestId?: string) { super(message); this.name = this.constructor.name; this.requestId = requestId; }
}
export class RPCError extends EliteError {
  readonly code = "rpc_error";
  constructor(public rpcName: string, public httpStatus: number, message: string, requestId?: string) { super(message, requestId); }
}
export class AuthError extends EliteError { readonly code = "auth_error"; }
export class TenantError extends EliteError { readonly code = "tenant_error"; }
export class RateLimitError extends EliteError {
  readonly code = "rate_limit_error";
  constructor(public retryAfter: number, message: string, requestId?: string) { super(message, requestId); }
}
export class ValidationError extends EliteError {
  readonly code = "validation_error";
  constructor(public field: string, message: string, requestId?: string) { super(message, requestId); }
}
export class ExternalAPIError extends EliteError {
  readonly code = "external_api_error";
  constructor(public provider: string, public httpStatus: number, message: string, requestId?: string) { super(message, requestId); }
}
