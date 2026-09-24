// thinking-payload-adapter.ts
//
// 协议请求 payload 中 thinking/reasoning 参数的安全归一化。
//
// 契约：
// - OpenAI / Anthropic 等协议全量等级原样直通，不做任何拦截或降级 fallback；
// - Google Generative AI：当 Gemini 模型缺失 thinkingLevel / thinkingBudget 参数时进行必要补全，避免上游报错；
// - 自定义上游或未匹配规则时，保留原始配置值，不擅自改写。

import { isObjectRecord } from "./common.ts";
import type { StateDocument } from "./types.ts";

type ActiveModelRef = {
	provider: string;
	id: string;
	api: string;
};

type PayloadRecord = Record<string, unknown>;

function isPayloadRecord(payload: unknown): payload is PayloadRecord {
	return isObjectRecord(payload);
}

export function adaptThinkingPayload(
	payload: unknown,
	model: ActiveModelRef | undefined,
	state: StateDocument,
): PayloadRecord | undefined {
	if (!model || !isPayloadRecord(payload)) return undefined;

	// OpenAI Responses / Completions / Anthropic: 不做任何官方端点拦截或降级 fallback，全量等级直接原样直通

	// 4. Google Generative AI wire format
	if (model.api === "google-generative-ai") {
		if (!isObjectRecord(payload.config)) return undefined;
		if (!isObjectRecord(payload.config.thinkingConfig)) return undefined;
		const thinkingConfig = payload.config.thinkingConfig;
		if (thinkingConfig.includeThoughts !== true) return undefined;

		// 检查 thinkingLevel 与 thinkingBudget 是否因扩展档位（xhigh/max）在 upstream 缺失设置
		if (thinkingConfig.thinkingLevel === undefined && thinkingConfig.thinkingBudget === undefined) {
			const id = model.id.toLowerCase();
			const isGemini3 = /gemini-3/.test(id) || /gemma-?4/.test(id) || id.includes("flash-latest");
			const updatedConfig = isGemini3
				? { ...thinkingConfig, thinkingLevel: "HIGH" }
				: { ...thinkingConfig, thinkingBudget: id.includes("flash-lite") ? 24576 : 32768 };

			return {
				...payload,
				config: {
					...payload.config,
					thinkingConfig: updatedConfig,
				},
			};
		}
		return undefined;
	}

	return undefined;
}
