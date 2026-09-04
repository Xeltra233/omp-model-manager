import assert from "node:assert/strict";
import test from "node:test";
import { adaptThinkingPayload } from "../thinking-payload-adapter.ts";
import type { StateDocument } from "../types.ts";

function createMockState(baseUrl: string): StateDocument {
	return {
		providers: {
			testProvider: {
				name: "Test Provider",
				api: "openai-responses",
				baseUrl,
				models: [],
			},
		},
		managedProviderIds: ["testProvider"],
		requestHeaderProfiles: {},
	};
}

test("OpenAI Responses: 全量 effort 直通，不进行官方端点拦截降级", () => {
	const officialState = createMockState("https://api.openai.com/v1");
	const payloadXhigh = { model: "o3-mini", reasoning: { effort: "xhigh" } };
	const adaptedXhigh = adaptThinkingPayload(payloadXhigh, { provider: "testProvider", id: "o3-mini", api: "openai-responses" }, officialState);
	assert.equal(adaptedXhigh, undefined, "xhigh 应原样直通，不得改写为 high");

	const payloadMax = { model: "o3-mini", reasoning: { effort: "max" } };
	const adaptedMax = adaptThinkingPayload(payloadMax, { provider: "testProvider", id: "o3-mini", api: "openai-responses" }, officialState);
	assert.equal(adaptedMax, undefined, "max 应原样直通，不得改写为 high");
});

test("OpenAI Completions: 全量 effort 直通，不进行官方端点拦截降级", () => {
	const officialState = createMockState("https://api.openai.com/v1");
	const payloadOfficial = { model: "o1", reasoning_effort: "xhigh" };
	const adaptedOfficial = adaptThinkingPayload(payloadOfficial, { provider: "testProvider", id: "o1", api: "openai-completions" }, officialState);
	assert.equal(adaptedOfficial, undefined, "官方端点也应直接原样直通");
});

test("Anthropic Messages: 全量 effort 直通，不进行官方端点拦截降级", () => {
	const officialState = createMockState("https://api.anthropic.com");
	const payloadMinimal = { model: "claude-3-7-sonnet", output_config: { effort: "minimal" } };
	const adaptedMinimal = adaptThinkingPayload(payloadMinimal, { provider: "testProvider", id: "claude-3-7-sonnet", api: "anthropic-messages" }, officialState);
	assert.equal(adaptedMinimal, undefined, "Anthropic 官方端点也应直接原样直通");
});

test("Google Generative AI: 补全缺失的 thinkingLevel / thinkingBudget", () => {
	const googleState = createMockState("https://generativelanguage.googleapis.com/v1beta");

	// Gemini 3 缺失 thinkingLevel 时安全补齐为 HIGH
	const payloadGemini3 = {
		model: "gemini-3.0-pro",
		config: { thinkingConfig: { includeThoughts: true } },
	};
	const adaptedGemini3 = adaptThinkingPayload(payloadGemini3, { provider: "testProvider", id: "gemini-3.0-pro", api: "google-generative-ai" }, googleState);
	assert.equal(adaptedGemini3?.config?.thinkingConfig?.thinkingLevel, "HIGH");

	// Gemini 2.5 缺失 thinkingBudget 时安全补齐为最大 budget
	const payloadGemini25 = {
		model: "gemini-2.5-pro",
		config: { thinkingConfig: { includeThoughts: true } },
	};
	const adaptedGemini25 = adaptThinkingPayload(payloadGemini25, { provider: "testProvider", id: "gemini-2.5-pro", api: "google-generative-ai" }, googleState);
	assert.equal(adaptedGemini25?.config?.thinkingConfig?.thinkingBudget, 32768);

	// 已有 thinkingLevel 时不重复改写
	const payloadAlreadySet = {
		model: "gemini-3.0-pro",
		config: { thinkingConfig: { includeThoughts: true, thinkingLevel: "LOW" } },
	};
	const adaptedAlreadySet = adaptThinkingPayload(payloadAlreadySet, { provider: "testProvider", id: "gemini-3.0-pro", api: "google-generative-ai" }, googleState);
	assert.equal(adaptedAlreadySet, undefined);
});
