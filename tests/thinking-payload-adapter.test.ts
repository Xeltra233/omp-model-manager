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

test("OpenAI Responses: 官方端点对于非原生 effort 执行安全 fallback", () => {
	const officialState = createMockState("https://api.openai.com/v1");

	// minimal -> low
	const payloadMinimal = { model: "o3-mini", reasoning: { effort: "minimal" } };
	const adaptedMinimal = adaptThinkingPayload(payloadMinimal, { provider: "testProvider", id: "o3-mini", api: "openai-responses" }, officialState);
	assert.equal(adaptedMinimal?.reasoning?.effort, "low");

	// ultra -> high
	const payloadUltra = { model: "o3-mini", reasoning: { effort: "ultra" } };
	const adaptedUltra = adaptThinkingPayload(payloadUltra, { provider: "testProvider", id: "o3-mini", api: "openai-responses" }, officialState);
	assert.equal(adaptedUltra?.reasoning?.effort, "high");

	// max -> high
	const payloadMax = { model: "o3-mini", reasoning: { effort: "max" } };
	const adaptedMax = adaptThinkingPayload(payloadMax, { provider: "testProvider", id: "o3-mini", api: "openai-responses" }, officialState);
	assert.equal(adaptedMax?.reasoning?.effort, "high");

	// 原生 high 不改写
	const payloadHigh = { model: "o3-mini", reasoning: { effort: "high" } };
	const adaptedHigh = adaptThinkingPayload(payloadHigh, { provider: "testProvider", id: "o3-mini", api: "openai-responses" }, officialState);
	assert.equal(adaptedHigh, undefined);
});

test("OpenAI Responses: 自定义第三方端点保留自定义 effort 绝不拦截", () => {
	const customState = createMockState("https://gateway.ai.example.com/v1");

	// ultra 在三方端点原样保留
	const payloadUltra = { model: "custom-o3", reasoning: { effort: "ultra" } };
	const adaptedUltra = adaptThinkingPayload(payloadUltra, { provider: "testProvider", id: "custom-o3", api: "openai-responses" }, customState);
	assert.equal(adaptedUltra, undefined);

	// max 在三方端点原样保留
	const payloadMax = { model: "custom-o3", reasoning: { effort: "max" } };
	const adaptedMax = adaptThinkingPayload(payloadMax, { provider: "testProvider", id: "custom-o3", api: "openai-responses" }, customState);
	assert.equal(adaptedMax, undefined);
});

test("OpenAI Completions: 官方端点安全 fallback，第三方端点原样直通", () => {
	const officialState = createMockState("https://api.openai.com/v1");
	const customState = createMockState("https://api.groq.com/openai/v1");

	const payloadOfficial = { model: "o1", reasoning_effort: "ultra" };
	const adaptedOfficial = adaptThinkingPayload(payloadOfficial, { provider: "testProvider", id: "o1", api: "openai-completions" }, officialState);
	assert.equal(adaptedOfficial?.reasoning_effort, "high");

	const payloadCustom = { model: "deepseek-r1", reasoning_effort: "ultra" };
	const adaptedCustom = adaptThinkingPayload(payloadCustom, { provider: "testProvider", id: "deepseek-r1", api: "openai-completions" }, customState);
	assert.equal(adaptedCustom, undefined);
});

test("Anthropic Messages: 官方端点对于 ultra 回退至 max，对 minimal 回退至 low", () => {
	const officialState = createMockState("https://api.anthropic.com");
	const customState = createMockState("https://anthropic.proxy.example.com");

	const payloadUltra = { model: "claude-3-7-sonnet", output_config: { effort: "ultra" } };
	const adaptedUltra = adaptThinkingPayload(payloadUltra, { provider: "testProvider", id: "claude-3-7-sonnet", api: "anthropic-messages" }, officialState);
	assert.equal(adaptedUltra?.output_config?.effort, "max");

	const payloadMinimal = { model: "claude-3-7-sonnet", output_config: { effort: "minimal" } };
	const adaptedMinimal = adaptThinkingPayload(payloadMinimal, { provider: "testProvider", id: "claude-3-7-sonnet", api: "anthropic-messages" }, officialState);
	assert.equal(adaptedMinimal?.output_config?.effort, "low");

	// 自定义端点原样保留
	const payloadCustom = { model: "claude-3-7-sonnet", output_config: { effort: "ultra" } };
	const adaptedCustom = adaptThinkingPayload(payloadCustom, { provider: "testProvider", id: "claude-3-7-sonnet", api: "anthropic-messages" }, customState);
	assert.equal(adaptedCustom, undefined);
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
