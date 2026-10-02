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

test("思考深度包含完整 7 档等级", () => {
	assert.deepEqual(ALL_THINKING_LEVELS, [
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
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

		// 所有非 off 档位（minimal, low, medium, high, xhigh, max）都必须存在且非 null
		for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"] as const) {
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
	assert.equal(upgradedOpenAI?.minimal, "minimal");
});

test("用户显式自定义 thinkingLevelMap 得到保留并与默认补齐", () => {
	const custom: ThinkingLevelMap = {
		high: "my-custom-high",
		xhigh: null,
		ultra: "custom-ultra",
	};
	const normalized = normalizeThinkingLevelMap("openai-responses", true, custom);
	assert.deepEqual(normalized, {
		minimal: "minimal",
		low: "low",
		medium: "medium",
		high: "my-custom-high",
		xhigh: null,
		max: "max",
		ultra: "custom-ultra",
	});
});

test("三套协议默认 map 全部恒等直通：选什么档就发什么值，不做任何静默改写", () => {
	const defaults = [
		["openai-completions", DEFAULT_OPENAI_THINKING_LEVEL_MAP],
		["openai-responses", DEFAULT_OPENAI_THINKING_LEVEL_MAP],
		["google-generative-ai", DEFAULT_GOOGLE_GENERATIVE_AI_THINKING_LEVEL_MAP],
		["anthropic-messages", DEFAULT_EXTENDED_THINKING_LEVEL_MAP],
	] as const;
	for (const [api, map] of defaults) {
		for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"] as const) {
			assert.equal(map[level], level, `${api} 默认 map 的 ${level} 必须恒等于自身`);
		}
		const built = buildThinkingLevelMap(api, true);
		assert.ok(built);
		for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"] as const) {
			assert.equal(built[level], level, `${api} buildThinkingLevelMap 的 ${level} 必须恒等于自身`);
		}
	}
});

test("旧版 Google 钳制默认（xhigh/max 被写成 high）载入时升级为恒等直通", () => {
	const legacyClamped: ThinkingLevelMap = {
		minimal: "minimal",
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "high",
		max: "high",
	};
	const upgraded = normalizeThinkingLevelMap("google-generative-ai", true, legacyClamped);
	assert.deepEqual(upgraded, DEFAULT_GOOGLE_GENERATIVE_AI_THINKING_LEVEL_MAP);
	assert.equal(upgraded?.xhigh, "xhigh");
	assert.equal(upgraded?.max, "max");

	// 用户真正自定义过的值不受影响
	const custom: ThinkingLevelMap = { ...legacyClamped, max: "my-max" };
	const kept = normalizeThinkingLevelMap("google-generative-ai", true, custom);
	assert.equal(kept?.max, "my-max");
	assert.equal(kept?.xhigh, "high");
});
