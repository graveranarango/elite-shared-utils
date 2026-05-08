import type { TenantContext } from "./tenant.ts";
import { logger } from "./logger.ts";
import { callRPC } from "./rpc-client.ts";

export type LLMProvider = "anthropic" | "openai" | "elevenlabs" | "assemblyai";
export interface LLMCostInput {
  provider: LLMProvider; model: string;
  tokensIn?: number; tokensOut?: number;
  audioSeconds?: number; characters?: number;
  costUsd: number; rpcName?: string; conversationId?: string;
}

export async function trackLLMCost(ctx: TenantContext, input: LLMCostInput): Promise<void> {
  try {
    await callRPC(ctx, "shared_log_cost", {
      service: input.provider, cost_usd: input.costUsd, model: input.model,
      tokens_input: input.tokensIn ?? null, tokens_output: input.tokensOut ?? null,
      caller: input.rpcName ?? null, caller_id: input.conversationId ?? null,
    });
  } catch (e) {
    logger.warn(ctx, "trackLLMCost_failed", { provider: input.provider, model: input.model, error: (e as Error).message });
  }
}
