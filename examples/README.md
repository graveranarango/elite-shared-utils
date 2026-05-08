# Examples

## elite-test-utils

A minimal Supabase Edge Function that imports each public export from
`@elite/shared-utils` and proves the API works end-to-end.

Deployed to elite-master at:
`https://uoznkapeedqgoiwebete.functions.supabase.co/elite-test-utils`

GET /  → health + module + version + exports[]
POST / → runs T6-T10 smoke tests:
  - T6 vault export typeof === "function"
  - T7 callRPC export typeof === "function"
  - T8 logger.info → JSON line with required fields
  - T9 PII sanitizer: phone/email/SSN/CC/api_key all redacted
  - T10 withRetry: 3rd attempt succeeds after 2 ExternalAPIError throws

NOTE: this example bundles the shared-utils source files inline (instead of
`jsr:@elite/shared-utils@0.1.0`) because the JSR module is not yet published.
After Jose publishes to JSR, replace the local imports with the JSR import.
