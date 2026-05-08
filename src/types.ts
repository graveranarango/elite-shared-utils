// Compact type declarations mirroring the elite-master schema (M3-M6).
// These are interface stubs for IDE autocomplete; the bridge always
// returns DB-validated jsonb so trust the runtime over these types.
export interface Customer { id: string; tenant_id: string; phone: string; email: string|null; first_name: string|null; last_name: string|null; status: string; created_at: string; }
export interface Vehicle { id: string; tenant_id: string; vin: string|null; year: number|null; make: string|null; model: string|null; }
export interface ConversationLia { id: string; tenant_id: string; customer_id: string|null; channel: string; status: string; last_message_at: string|null; created_at: string; }
export interface ConversationSofia { id: string; tenant_id: string; customer_id: string|null; channel: string|null; status: string; created_at: string; }
export interface Thread { id: string; tenant_id: string; conversation_id: string; topic: string; urgency_score: number|string|null; status: string; }
export interface MessageLia { id: string; tenant_id: string; thread_id: string; conversation_id: string; direction: "inbound"|"outbound"; channel: string; content: string|null; created_at: string; }
export interface DealBrief { id: string; tenant_id: string; customer_id: string; vehicle_target: unknown; status: string; created_at: string; }
export interface Pencil { id: string; tenant_id: string; deal_brief_id: string; dealer_partner_id: string|null; price_otd: number|string|null; }
export interface NegotiationRound { id: string; tenant_id: string; deal_brief_id: string; round_number: number; round_type: string; status: string; }
export interface BidProposal { id: string; negotiation_round_id: string; bid_amount: number|string|null; bid_status: string; }
export interface Listing { id: string; tenant_id: string; customer_id: string; vehicle_specs: unknown; status: string; expires_at: string|null; }
export interface Briefing { id: string; tenant_id: string; briefing_date: string; payload: unknown; }
export interface Decision { id: string; tenant_id: string; decision_topic: string; rationale: string|null; }
