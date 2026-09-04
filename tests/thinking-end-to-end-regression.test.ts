import assert from "node:assert/strict";
import test from "node:test";
import { buildModelFromDraft, createModelDraftFromStoredModel } from "../state-document.ts";
import { buildStateDocumentFromModelsConfig } from "../state-store.ts";
import { ALL_THINKING_LEVELS, type StoredModel, type StoredProvider, type ThinkingLevelMap } from "../types.ts";

test("端到端回归：模型创建、重命名、持久化重载保留完整 8 档思维等级", async () => {
	const customMap: ThinkingLevelMap = {
		minimal: "low",
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "xhigh",
		max: "max",
		ultra: "ultra",
	};

	const modelsConfigDoc = {
		providers: {
			testProvider: {
				name: "Thinking Provider",
				api: "openai-responses" as const,
				baseUrl: "https://api.openai.com/v1",
				models: [
					{
						id: "deep-thinker-v1",
						name: "Deep Thinker V1",
						reasoning: true,
						input: ["text", "image"] as ("text" | "image")[],
						contextWindow: 200_000,
						maxTokens: 32_000,
						thinkingLevelMap: customMap,
					},
				],
			},
		},
	};

	const metadataDoc = {
		version: 2,
		managedProviderIds: ["testProvider"],
		providers: {
			testProvider: {
				clientHeaderProfile: "recommended" as const,
			},
		},
		models: {},
		requestHeaderProfiles: {},
	};

	// 1. 从配置构建运行时状态
	const stateDoc = await buildStateDocumentFromModelsConfig(modelsConfigDoc, metadataDoc);
	const model = stateDoc.providers.testProvider?.models[0];
	assert.ok(model, "模型必须成功构建");
	assert.equal(model.id, "deep-thinker-v1");
	assert.equal(model.reasoning, true);

	// 2. 验证 8 档所有等级均保持完整
	assert.deepEqual(model.thinkingLevelMap, customMap);
	for (const level of ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const) {
		assert.equal(model.thinkingLevelMap?.[level], level === "minimal" ? "low" : level);
	}

	// 3. 重命名模型并再次归一化
	const testProvider = stateDoc.providers.testProvider!;
	const draft = createModelDraftFromStoredModel("testProvider", testProvider, model);
	draft.modelId = "deep-thinker-v2";
	const renamed = buildModelFromDraft(model, draft, testProvider.compat);
	assert.equal(renamed.id, "deep-thinker-v2");
	assert.deepEqual(renamed.thinkingLevelMap, customMap);
});

test("未知 thinking level key 在 schema 校验层产生预期拒绝", async () => {
	const { parseStateFile } = await import("../state-metadata-store.ts");
	const invalidJson = JSON.stringify({
		version: 1,
		providers: {
			custom: {
				name: "Custom",
				api: "openai-responses",
				baseUrl: "https://api.openai.com/v1",
				models: [
					{
						id: "model-1",
						reasoning: true,
						input: ["text"],
						contextWindow: 128000,
						maxTokens: 4096,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						thinkingLevelMap: {
							invalid_level_key: "value",
						},
					},
				],
			},
		},
	});

	assert.throws(
		() => parseStateFile(invalidJson),
		/未知 thinking level/,
		"非法 thinking level 键必须被 schema 校验明确拦截",
	);
});

test("ALL_THINKING_LEVELS 常量数组包含完整的顺序集合", () => {
	const expected = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
	assert.equal(ALL_THINKING_LEVELS.length, 8);
	assert.deepEqual([...ALL_THINKING_LEVELS], expected);
});
