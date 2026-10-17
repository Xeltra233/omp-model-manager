// Anthropic thinking 协议能力表回归：
// - OMP 用 thinking.mode（anthropic-adaptive / budget）决定上游发 adaptive 还是 budget；
// - Claude 4.7+ 只接受 adaptive，4.5- 只接受 extended，双模保持用户选择；
// - 注册、models.yml 同步、启动迁移和请求兜底必须给出同一个结论。

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test, { after } from "node:test";
import {
	buildAnthropicThinkingConfig,
	getAnthropicThinkingSupport,
	normalizeAnthropicThinkingPayload,
	resolveAnthropicThinkingProtocol,
	resolveThinkingProtocolFromMode,
} from "../anthropic-thinking.ts";
import { buildModelFromDraft, createModelDraftFromStoredModel, findAnthropicThinkingNormalizationTargets, normalizeAnthropicThinkingInDocument } from "../state-document.ts";
import { buildStateDocumentFromModelsConfig } from "../state-store.ts";
import { buildSynchronizedModelsDocument } from "../models-config-sync.ts";
import { reconcileProvider } from "../provider-registrar.ts";
import { adaptThinkingPayload } from "../thinking-payload-adapter.ts";
import type { StateDocument, StoredModel, StoredProvider } from "../types.ts";

const agentDir = await mkdtemp(resolve(".test-anthropic-thinking-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
after(async () => { await rm(agentDir, { recursive: true, force: true }); });

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function model(id: string, patch: Partial<StoredModel> = {}): StoredModel {
	return { id, reasoning: true, input: ["text"], contextWindow: 200_000, maxTokens: 64_000, cost: { ...ZERO_COST }, ...patch };
}

function provider(models: StoredModel[], patch: Partial<StoredProvider> = {}): StoredProvider {
	return {
		name: "relay",
		api: "anthropic-messages",
		baseUrl: "https://relay.invalid",
		managed: true,
		clientHeaderProfile: "recommended",
		models,
		...patch,
	};
}

function document(providers: Record<string, StoredProvider>): StateDocument {
	return {
		version: 2,
		providers,
		managedProviderIds: Object.keys(providers),
		requestHeaderProfiles: {},
		clientHeaderCaptures: {},
	};
}

test("能力表按官方 per-model 表归类 thinking 协议", () => {
	assert.equal(resolveAnthropicThinkingProtocol("claude-opus-5-5"), "adaptive");
	assert.equal(resolveAnthropicThinkingProtocol("claude-opus-5.5"), "adaptive");
	assert.equal(resolveAnthropicThinkingProtocol("claude-opus-5-5-thinking"), "adaptive");
	assert.equal(resolveAnthropicThinkingProtocol("anthropic/claude-opus-5-5[1m]"), "adaptive");
	assert.equal(resolveAnthropicThinkingProtocol("claude-sonnet-5"), "adaptive");
	assert.equal(resolveAnthropicThinkingProtocol("claude-haiku-5-5"), "adaptive");
	assert.equal(resolveAnthropicThinkingProtocol("claude-fable-5-1"), "adaptive");
	assert.equal(resolveAnthropicThinkingProtocol("kimi-for-coding"), "adaptive");

	assert.equal(resolveAnthropicThinkingProtocol("claude-opus-4-6"), undefined);
	assert.equal(resolveAnthropicThinkingProtocol("claude-mythos-preview"), undefined);
	assert.equal(resolveAnthropicThinkingProtocol("claude-opus-4-5"), "legacy");
	assert.equal(resolveAnthropicThinkingProtocol("claude-sonnet-4-5-20250929"), "legacy");
	assert.equal(resolveAnthropicThinkingProtocol("claude-3-7-sonnet"), "legacy");
	assert.equal(resolveAnthropicThinkingProtocol("gpt-5.6-sol"), undefined);

	assert.equal(getAnthropicThinkingSupport("claude-opus-5-5")?.rejectsDisabled, true);
	assert.equal(getAnthropicThinkingSupport("claude-opus-4-7")?.rejectsDisabled, false);
	assert.equal(resolveThinkingProtocolFromMode("anthropic-adaptive"), "adaptive");
	assert.equal(resolveThinkingProtocolFromMode("budget"), "legacy");
	assert.equal(resolveThinkingProtocolFromMode("anthropic-budget-effort"), "legacy");
	assert.equal(resolveThinkingProtocolFromMode("effort"), undefined);
});

test("thinking 配置只改 mode / efforts，保留 effortMap 等原生字段", () => {
	const existing = { mode: "effort" as const, efforts: ["low", "high"], effortMap: { high: "max" }, supportsDisplay: true };
	const config = buildAnthropicThinkingConfig(existing, "claude-opus-5-5", "legacy");
	assert.equal(config.mode, "anthropic-adaptive");
	assert.deepEqual(config.efforts, ["low", "high"]);
	assert.deepEqual(config.effortMap, { high: "max" });
	assert.equal(config.supportsDisplay, true);

	const legacy = buildAnthropicThinkingConfig(undefined, "claude-opus-4-5", "adaptive");
	assert.equal(legacy.mode, "budget");
	assert.ok(legacy.efforts?.length);
});

test("草稿与保存以能力表为准，并清掉 OMP 不读的 forceAdaptiveThinking", () => {
	const relay = provider([]);
	const adaptiveModel = model("claude-opus-5-5", { compat: { forceAdaptiveThinking: true, supportsContextManagement: true } });
	const draft = createModelDraftFromStoredModel("relay", relay, adaptiveModel);
	assert.equal(draft.anthropicThinkingProtocol, "adaptive");

	draft.anthropicThinkingProtocol = "legacy";
	const saved = buildModelFromDraft(adaptiveModel, draft, relay.compat);
	assert.equal(saved.thinking?.mode, "anthropic-adaptive");
	assert.equal(saved.compat?.forceAdaptiveThinking, undefined);
	assert.equal(saved.compat?.supportsContextManagement, true);

	const legacyModel = model("claude-opus-4-5");
	const legacyDraft = createModelDraftFromStoredModel("relay", relay, legacyModel);
	assert.equal(legacyDraft.anthropicThinkingProtocol, "legacy");
	legacyDraft.anthropicThinkingProtocol = "adaptive";
	const legacySaved = buildModelFromDraft(legacyModel, legacyDraft, relay.compat);
	assert.equal(legacySaved.thinking?.mode, "budget");

	// 双模模型尊重用户选择。
	const bothModel = model("claude-opus-4-6");
	const bothDraft = createModelDraftFromStoredModel("relay", relay, bothModel);
	assert.equal(bothDraft.anthropicThinkingProtocol, "legacy");
	bothDraft.anthropicThinkingProtocol = "adaptive";
	assert.equal(buildModelFromDraft(bothModel, bothDraft, relay.compat).thinking?.mode, "anthropic-adaptive");
});

test("state 与 models.yml 双向往返保留 thinking.mode", async () => {
	const source = {
		providers: {
			relay: {
				name: "relay",
				api: "anthropic-messages",
				baseUrl: "https://relay.invalid",
				ompModelManager: { managed: true },
				models: [{ id: "claude-opus-5-5", reasoning: true, thinking: { mode: "budget", efforts: ["low", "high"] } }],
			},
		},
	};
	const state = await buildStateDocumentFromModelsConfig(source as never, {
		version: 2,
		managedProviderIds: ["relay"],
		providers: { relay: { clientHeaderProfile: "recommended" } },
		models: {},
		requestHeaderProfiles: {},
		clientHeaderCaptures: {},
	});
	const stored = state.providers.relay!.models[0]!;
	assert.equal(stored.thinking?.mode, "budget");

	const synced = buildSynchronizedModelsDocument(state, source as never, [], ["relay"]);
	const entry = synced.providers.relay?.models?.[0] as { thinking?: { mode?: string; efforts?: string[] } };
	// 保存路径还没修正 mode，同步按能力表强制 adaptive。
	assert.equal(entry.thinking?.mode, "anthropic-adaptive");
	assert.deepEqual(entry.thinking?.efforts, ["low", "high"]);
});

test("启动迁移补齐缺失的 thinking.mode 并幂等", () => {
	const relay = provider([model("claude-opus-5-5"), model("claude-opus-4-5"), model("gpt-5.6-sol")]);
	const native = provider([model("claude-opus-5-5")], { managed: false, name: "native" });
	const before = document({ relay, native });
	const source = {
		providers: {
			relay: {
				api: "anthropic-messages",
				models: [
					{ id: "claude-opus-5-5" },
					{ id: "claude-opus-4-5", thinking: { mode: "budget", efforts: ["low"] } },
					{ id: "gpt-5.6-sol" },
				],
			},
			native: { api: "anthropic-messages", models: [{ id: "claude-opus-5-5" }] },
		},
	};

	const targets = findAnthropicThinkingNormalizationTargets(before, source);
	assert.deepEqual(targets, [{ providerId: "relay", modelIds: ["claude-opus-5-5"] }]);

	const normalized = normalizeAnthropicThinkingInDocument(before, targets.map((target) => target.providerId));
	assert.equal(normalized.providers.relay!.models[0]!.thinking?.mode, "anthropic-adaptive");
	assert.equal(normalized.providers.native!.models[0]!.thinking, undefined);

	const synced = buildSynchronizedModelsDocument(normalized, source as never, [], ["relay"]);
	assert.deepEqual(findAnthropicThinkingNormalizationTargets(normalized, synced), []);

	// 旧版本留下的 forceAdaptiveThinking 也算需要迁移（OMP 不读，且不是合法 compat 键）。
	const staleCompat = document({ relay: provider([model("claude-opus-5-5", { thinking: { mode: "anthropic-adaptive" } })]) });
	const staleSource = { providers: { relay: { api: "anthropic-messages", models: [{ id: "claude-opus-5-5", compat: { forceAdaptiveThinking: true } }] } } };
	assert.deepEqual(findAnthropicThinkingNormalizationTargets(staleCompat, staleSource), [
		{ providerId: "relay", modelIds: ["claude-opus-5-5"] },
	]);
	const cleaned = normalizeAnthropicThinkingInDocument(staleCompat, ["relay"]);
	assert.equal(cleaned.providers.relay!.models[0]!.compat, undefined);
});

test("注册层把 thinking.mode 传给 OMP runtime", async () => {
	const captured: Array<{ models?: Array<Record<string, any>> }> = [];
	const pi = { registerProvider: (_id: string, config: { models?: Array<Record<string, any>> }) => captured.push(config), unregisterProvider: () => {} } as never;
	await reconcileProvider(pi, "relay", provider([model("claude-opus-5-5"), model("claude-opus-4-5")]));
	const models = captured.at(-1)!.models!;
	assert.equal(models.find((entry) => entry.id === "claude-opus-5-5")?.thinking?.mode, "anthropic-adaptive");
	assert.equal(models.find((entry) => entry.id === "claude-opus-4-5")?.thinking?.mode, "budget");
});

test("请求兜底把 legacy thinking 改写成 adaptive 并补 effort", () => {
	const payload = { model: "claude-opus-5-5", max_tokens: 64_000, thinking: { type: "enabled", budget_tokens: 8192, display: "summarized" } };
	const state = document({ relay: provider([model("claude-opus-5-5")]) });
	const rewritten = adaptThinkingPayload(payload, { provider: "relay", id: "claude-opus-5-5", api: "anthropic-messages" }, state)!;
	assert.equal((rewritten.thinking as any).type, "adaptive");
	assert.equal((rewritten.thinking as any).budget_tokens, undefined);
	assert.deepEqual(rewritten.output_config, { effort: "medium" });
	assert.equal(payload.thinking.type, "enabled", "原始 payload 不可变");

	const disabled = normalizeAnthropicThinkingPayload({ model: "claude-opus-5-5", thinking: { type: "disabled" } }, "claude-opus-5-5") as Record<string, unknown>;
	assert.equal("thinking" in disabled, false);

	assert.equal(adaptThinkingPayload(
		{ model: "claude-opus-4-5", thinking: { type: "enabled", budget_tokens: 4096 } },
		{ provider: "relay", id: "claude-opus-4-5", api: "anthropic-messages" },
		state,
	), undefined);
	assert.equal(adaptThinkingPayload(
		{ model: "claude-opus-4-6", thinking: { type: "enabled", budget_tokens: 4096 } },
		{ provider: "relay", id: "claude-opus-4-6", api: "anthropic-messages" },
		state,
	), undefined);
});
