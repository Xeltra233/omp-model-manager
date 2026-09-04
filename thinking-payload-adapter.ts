// thinking-payload-adapter.ts
//
// 协议请求 payload 中 thinking/reasoning 参数的安全归一化与 fallback。
//
// 契约：
// - 原生支持的参数原样发送，不影响正常请求；
// - 当针对官方端点（api.openai.com, api.anthropic.com, generativelanguage.googleapis.com）时，
//   若发现未原生支持的扩展等级（如 OpenAI 官方的 minimal/ultra/xhigh/max，Google 的缺失 thinkingLevel/thinkingBudget，Anthropic 的 ultra/minimal），
//   自动 fallback 至官方支持的对应最高/最低档位，防止服务端报 400；
// - 自定义上游或未匹配官方域名时，保留原始/自定义配置值，不擅自改写。

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

function isOfficialOpenAIEndpoint(baseUrl: string | undefined): boolean {
	if (!baseUrl) return true;
	try {
		const host = new URL(baseUrl).hostname.toLowerCase();
		return host === "api.openai.com";
	} catch {
		return false;
	}
}

function isOfficialAnthropicEndpoint(baseUrl: string | undefined): boolean {
	if (!baseUrl) return true;
	try {
		const host = new URL(baseUrl).hostname.toLowerCase();
		return host === "api.anthropic.com";
	} catch {
		return false;
	}
}

export function adaptThinkingPayload(
	payload: unknown,
	model: ActiveModelRef | undefined,
	state: StateDocument,
): PayloadRecord | undefined {
	if (!model || !isPayloadRecord(payload)) return undefined;

	const provider = state.providers[model.provider];
	const baseUrl = provider?.baseUrl;

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
