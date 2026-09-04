// OMP 内置模型 catalog 边界。
//
// 提供 OMP 内置 Provider ID 集合与默认端点信息，避免自定义接入与内置接入冲突，
// 并为常见内置 Provider 提供推荐 API 协议和 Base URL。

import type { ApiKind } from "./types.ts";

export interface BuiltinProviderDefaults {
	api?: ApiKind;
	baseUrl?: string;
}

const BUILTIN_PROVIDERS_MAP: Record<string, BuiltinProviderDefaults> = {
	"openai": { api: "openai-responses", baseUrl: "https://api.openai.com/v1" },
	"openai-completions": { api: "openai-completions", baseUrl: "https://api.openai.com/v1" },
	"anthropic": { api: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
	"google": { api: "google-generative-ai", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
	"gemini": { api: "google-generative-ai", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
	"groq": { api: "openai-completions", baseUrl: "https://api.groq.com/openai/v1" },
	"cerebras": { api: "openai-completions", baseUrl: "https://api.cerebras.ai/v1" },
	"xai": { api: "openai-completions", baseUrl: "https://api.x.ai/v1" },
	"openrouter": { api: "openai-completions", baseUrl: "https://openrouter.ai/api/v1" },
	"mistral": { api: "openai-completions", baseUrl: "https://api.mistral.ai/v1" },
	"zai": { api: "openai-completions", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
	"minimax": { api: "openai-completions", baseUrl: "https://api.minimax.chat/v1" },
	"opencode": { api: "openai-completions", baseUrl: "https://api.opencode.ai/v1" },
	"deepseek": { api: "openai-completions", baseUrl: "https://api.deepseek.com/v1" },
	"azure-openai": { api: "openai-completions" },
	"bedrock": { api: "anthropic-messages" },
	"vertex": { api: "google-generative-ai" },
};

const BUILTIN_PROVIDER_IDS = new Set<string>(Object.keys(BUILTIN_PROVIDERS_MAP));

export async function getBuiltinProviderIds(): Promise<ReadonlySet<string>> {
	return BUILTIN_PROVIDER_IDS;
}

export async function isBuiltinProviderId(providerId: string): Promise<boolean> {
	return BUILTIN_PROVIDER_IDS.has(providerId);
}

export async function getBuiltinProviderDefaults(
	providerId: string,
): Promise<BuiltinProviderDefaults | undefined> {
	return BUILTIN_PROVIDERS_MAP[providerId];
}
