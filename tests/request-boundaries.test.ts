// request-boundaries.test.ts
//
// 同步自 pi-model-manager（f7ece7c + 1f8420c）：
// - ClaudeCode 原生 1M beta 请求头注入边界；
// - ModelDraft 对 claudeCode1mContext 的同步与持久化；
// - provider 级 forceAdaptiveThinking 继承回归。

import assert from "node:assert/strict";
import test from "node:test";
import { getClientHeadersForProfile } from "../presets/client-headers.ts";
import { buildModelRequestHeaders } from "../provider-registrar.ts";
import { buildModelFromDraft, createModelDraftFromStoredModel } from "../state-document.ts";
import type { StoredModel, StoredProvider } from "../types.ts";

test("ClaudeCode 原生 1M 仅在开启且上下文窗口达到 1M 时注入 beta 请求头", () => {
	// 1. 未开启 1M 时，即使窗口为 1M 也不带 1M beta
	const headersWithoutOptIn = getClientHeadersForProfile("claude-code", "anthropic-messages", {}, {}, {}, 1_000_000);
	assert.equal(headersWithoutOptIn?.["anthropic-beta"]?.includes("context-1m-2025-08-07"), false);

	// 2. 开启 1M 但上下文小于 1M（如 200k）时，设置无效，不注入 1M beta
	const headersSmallContext = getClientHeadersForProfile("claude-code", "anthropic-messages", {}, {}, { claudeCode1mContext: true }, 200_000);
	assert.equal(headersSmallContext?.["anthropic-beta"]?.includes("context-1m-2025-08-07"), false);

	// 3. 开启 1M 且上下文达到 1M（1000000）时，正常注入 1M beta
	const headers1m = getClientHeadersForProfile("claude-code", "anthropic-messages", {}, {}, { claudeCode1mContext: true }, 1_000_000);
	assert.equal(headers1m?.["anthropic-beta"]?.includes("context-1m-2025-08-07"), true);

	// 4. 通过 buildModelRequestHeaders 端到端测试
	const ccProvider: StoredProvider = {
		name: "ClaudeGateway", api: "anthropic-messages", baseUrl: "https://gw.test/v1", managed: true,
		clientHeaderProfile: "recommended",
		models: [],
	};
	const model200k: StoredModel = { id: "sonnet-200k", reasoning: true, input: ["text"], contextWindow: 200_000, maxTokens: 16000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { claudeCode1mContext: true } };
	const model1m: StoredModel = { id: "sonnet-1m", reasoning: true, input: ["text"], contextWindow: 1_000_000, maxTokens: 32000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { claudeCode1mContext: true } };

	const headersResult200k = buildModelRequestHeaders(ccProvider, model200k, {}, {})!;
	assert.equal(headersResult200k["anthropic-beta"]?.includes("context-1m-2025-08-07"), false);

	const headersResult1m = buildModelRequestHeaders(ccProvider, model1m, {}, {})!;
	assert.equal(headersResult1m["anthropic-beta"]?.includes("context-1m-2025-08-07"), true);
});

test("ModelDraft 正确同步与持久化 claudeCode1mContext 兼容设置", async () => {
	const ccProvider: StoredProvider = {
		name: "ClaudeGateway", api: "anthropic-messages", baseUrl: "https://gw.test/v1", managed: true,
		clientHeaderProfile: "claude-code",
		models: [],
	};
	const stored1mModel: StoredModel = {
		id: "sonnet-test", reasoning: true, input: ["text"], contextWindow: 1_000_000, maxTokens: 32000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { claudeCode1mContext: true },
	};
	const draft = createModelDraftFromStoredModel("ClaudeGateway", ccProvider, stored1mModel);
	assert.equal(draft.claudeCode1mContext, true);
	assert.equal(draft.contextWindow, 1_000_000);

	// 保存时保留该 compat
	const savedModel = buildModelFromDraft(stored1mModel, draft, ccProvider.compat);
	assert.equal(savedModel.compat?.claudeCode1mContext, true);

	// 关闭开关后保存
	draft.claudeCode1mContext = false;
	const savedDisabled = buildModelFromDraft(stored1mModel, draft, ccProvider.compat);
	assert.equal(savedDisabled.compat?.claudeCode1mContext, undefined);
});

test("provider 级 forceAdaptiveThinking 下放到无覆盖模型且保存不写入显式 false", async () => {
	const provider: StoredProvider = {
		name: "ClaudeGateway", api: "anthropic-messages", baseUrl: "https://gw.test/v1", managed: true,
		clientHeaderProfile: "claude-code", compat: { forceAdaptiveThinking: true }, models: [],
	};
	const plainModel: StoredModel = {
		id: "sonnet", reasoning: true, input: ["text"], contextWindow: 200_000, maxTokens: 16000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};

	// 模型无自身覆盖时应继承 provider 级设置，草稿为 adaptive
	const draft = createModelDraftFromStoredModel("ClaudeGateway", provider, plainModel);
	assert.equal(draft.anthropicThinkingProtocol, "adaptive");

	// 未改动开关直接保存时，不得把显式 false 写进模型 compat
	draft.modelName = "renamed";
	const saved = buildModelFromDraft(plainModel, draft, provider.compat);
	assert.equal(saved.compat?.forceAdaptiveThinking, undefined);

	// 模型级显式关闭仍优先于 provider 级开启
	const legacyModel: StoredModel = { ...plainModel, id: "sonnet-legacy", compat: { forceAdaptiveThinking: false } };
	const legacyDraft = createModelDraftFromStoredModel("ClaudeGateway", provider, legacyModel);
	assert.equal(legacyDraft.anthropicThinkingProtocol, "legacy");
});
