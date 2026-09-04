import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_EXTENDED_THINKING_LEVEL_MAP,
	DEFAULT_GOOGLE_GENERATIVE_AI_THINKING_LEVEL_MAP,
	DEFAULT_OPENAI_THINKING_LEVEL_MAP,
	buildThinkingLevelMap,
	normalizeThinkingLevelMap,
} from "../presets/thinking.ts";
import { ALL_THINKING_LEVELS, type ThinkingLevelMap } from "../types.ts";

test("思考深度包含完整 8 档等级", () => {
	assert.deepEqual(ALL_THINKING_LEVELS, [
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
		"ultra",
	]);
});

test("各协议默认 thinkingLevelMap 包含所有非 off 档位且无默认 null 裁剪", () => {
	for (const [api, map] of [
		["openai-responses", DEFAULT_OPENAI_THINKING_LEVEL_MAP],
		["openai-completions", DEFAULT_OPENAI_THINKING_LEVEL_MAP],
		["google-generative-ai", DEFAULT_GOOGLE_GENERATIVE_AI_THINKING_LEVEL_MAP],
		["anthropic-messages", DEFAULT_EXTENDED_THINKING_LEVEL_MAP],
	] as const) {
		const built = buildThinkingLevelMap(api, true);
		assert.ok(built, `${api} 默认 map 必须存在`);
		assert.deepEqual(built, map);

		// 所有非 off 档位（minimal, low, medium, high, xhigh, max, ultra）都必须存在且非 null
		for (const level of ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const) {
			assert.notEqual(built[level], null, `${api} 的 ${level} 不能为 null`);
			assert.notEqual(built[level], undefined, `${api} 的 ${level} 必须有默认映射`);
		}
	}
});

test("reasoning=false 时 normalize 返回 undefined", () => {
	assert.equal(normalizeThinkingLevelMap("openai-responses", false, undefined), undefined);
	assert.equal(normalizeThinkingLevelMap("google-generative-ai", false, { high: "high" }), undefined);
});

test("历史锁死配置（如 Google xhigh/max 为 null 或 OpenAI minimal 为 null）平滑升级为全解锁", () => {
	const legacyGoogleMap: ThinkingLevelMap = {
		minimal: "minimal",
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: null,
		max: null,
	};
	const upgradedGoogle = normalizeThinkingLevelMap("google-generative-ai", true, legacyGoogleMap);
	assert.deepEqual(upgradedGoogle, DEFAULT_GOOGLE_GENERATIVE_AI_THINKING_LEVEL_MAP);
	assert.notEqual(upgradedGoogle?.xhigh, null);
	assert.notEqual(upgradedGoogle?.max, null);
	assert.equal(upgradedGoogle?.ultra, "ultra");

	const legacyOpenAIMap: ThinkingLevelMap = {
		minimal: null,
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "xhigh",
		max: "max",
	};
	const upgradedOpenAI = normalizeThinkingLevelMap("openai-responses", true, legacyOpenAIMap);
	assert.deepEqual(upgradedOpenAI, DEFAULT_OPENAI_THINKING_LEVEL_MAP);
	assert.equal(upgradedOpenAI?.minimal, "low");
	assert.equal(upgradedOpenAI?.ultra, "ultra");
});

test("用户显式自定义 thinkingLevelMap 得到保留并与默认补齐", () => {
	const custom: ThinkingLevelMap = {
		high: "my-custom-high",
		xhigh: null,
		ultra: "custom-ultra",
	};
	const normalized = normalizeThinkingLevelMap("openai-responses", true, custom);
	assert.deepEqual(normalized, {
		minimal: "low",
		low: "low",
		medium: "medium",
		high: "my-custom-high",
		xhigh: null,
		max: "max",
		ultra: "custom-ultra",
	});
});
