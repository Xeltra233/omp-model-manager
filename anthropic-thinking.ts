// Anthropic thinking 协议能力表（对齐官方 per-model 配置表，2026-10）。
//
// OMP 用 `thinking.mode` 决定 Anthropic 上游的 thinking 形状：
//   - "anthropic-adaptive" → thinking.type=adaptive（+ output_config.effort）
//   - "budget" / "anthropic-budget-effort" → thinking.type=enabled + budget_tokens
// 官方结论：Claude 4.7 及更新模型只接受 adaptive，发送 enabled 会 400；
// Claude 4.5 及更早只接受 enabled，发送 adaptive 也会 400。双模（4.6）保持用户选择。
// 另外 Fable/Mythos 5、Opus 5.5、Sonnet 5.5 不能关闭思考。

import { isObjectRecord } from "./common.ts";
import type { AnthropicThinkingProtocol, ModelThinkingConfig, ThinkingControlMode } from "./types.ts";

export interface AnthropicThinkingSupport {
	adaptive: boolean;
	extended: boolean;
	/** 拒绝 thinking.type=disabled（模型始终思考）。 */
	rejectsDisabled: boolean;
}

export const DEFAULT_THINKING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

const ADAPTIVE_ONLY: AnthropicThinkingSupport = { adaptive: true, extended: false, rejectsDisabled: false };
const ADAPTIVE_ONLY_ALWAYS_ON: AnthropicThinkingSupport = { adaptive: true, extended: false, rejectsDisabled: true };
const BOTH: AnthropicThinkingSupport = { adaptive: true, extended: true, rejectsDisabled: false };
const BOTH_ALWAYS_ON: AnthropicThinkingSupport = { adaptive: true, extended: true, rejectsDisabled: true };
const EXTENDED_ONLY: AnthropicThinkingSupport = { adaptive: false, extended: true, rejectsDisabled: false };

const THIRD_PARTY_ADAPTIVE_ONLY_IDS = new Set(["k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"]);

const VARIANT_SUFFIXES = [
	"-thinking",
	"-reasoning",
	"-thinking-none",
	"-thinking-high",
	"-xhigh",
	"-max",
	"-high",
	"-medium",
	"-low",
	"-none",
];

const CLAUDE_GENERATION_PATTERN = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?$/;
const CLAUDE_LEGACY_NAMING_PATTERN = /^claude-3(?:-\d+)?-(?:opus|sonnet|haiku)$/;
const FABLE_MYTHOS_PATTERN = /^claude-(fable|mythos)-5(?:-\d+)?$/;

export function normalizeAnthropicModelId(modelId: string): string {
	let id = modelId.trim().toLowerCase();
	id = id.replace(/\[[^\]]*\]/g, "").replace(/[（(][^)）]*[)）]/g, "");
	id = id.trim();
	const lastSpace = id.lastIndexOf(" ");
	if (lastSpace >= 0) id = id.slice(lastSpace + 1);
	const lastSlash = id.lastIndexOf("/");
	if (lastSlash >= 0) id = id.slice(lastSlash + 1);
	id = id.replace(/(\d)\.(\d)/g, "$1-$2");
	id = id.replace(/-\d{8}$/, "");
	let changed = true;
	while (changed) {
		changed = false;
		for (const suffix of VARIANT_SUFFIXES) {
			if (!id.endsWith(suffix) || id.length === suffix.length) continue;
			id = id.slice(0, -suffix.length);
			changed = true;
		}
	}
	return id;
}

export function getAnthropicThinkingSupport(modelId: string): AnthropicThinkingSupport | undefined {
	const id = normalizeAnthropicModelId(modelId);
	if (THIRD_PARTY_ADAPTIVE_ONLY_IDS.has(id)) return ADAPTIVE_ONLY;
	if (id === "claude-mythos-preview") return BOTH_ALWAYS_ON;
	if (FABLE_MYTHOS_PATTERN.test(id)) return ADAPTIVE_ONLY_ALWAYS_ON;
	if (id === "claude-opus-5-5" || id === "claude-sonnet-5-5") return ADAPTIVE_ONLY_ALWAYS_ON;
	if (CLAUDE_LEGACY_NAMING_PATTERN.test(id)) return EXTENDED_ONLY;
	const generation = CLAUDE_GENERATION_PATTERN.exec(id);
	if (!generation) return undefined;
	const major = Number(generation[2]);
	const minor = generation[3] === undefined ? 0 : Number(generation[3]);
	if (major >= 5 || (major === 4 && minor >= 7)) return ADAPTIVE_ONLY;
	if (major === 4 && minor === 6) return BOTH;
	if (major <= 4) return EXTENDED_ONLY;
	return undefined;
}

/** 模型只接受一种协议时返回该协议；双模或未知模型返回 undefined。 */
export function resolveAnthropicThinkingProtocol(modelId: string): AnthropicThinkingProtocol | undefined {
	const support = getAnthropicThinkingSupport(modelId);
	if (!support) return undefined;
	if (support.adaptive && !support.extended) return "adaptive";
	if (support.extended && !support.adaptive) return "legacy";
	return undefined;
}

export function isAnthropicThinkingDisabledRejected(modelId: string): boolean {
	return getAnthropicThinkingSupport(modelId)?.rejectsDisabled === true;
}

/** OMP 的 thinking.mode 与插件里 Adaptive/Legacy 开关的对应关系。 */
export function resolveThinkingProtocolFromMode(mode: string | undefined): AnthropicThinkingProtocol | undefined {
	if (mode === "anthropic-adaptive") return "adaptive";
	if (mode === "budget" || mode === "anthropic-budget-effort") return "legacy";
	return undefined;
}

export function resolveAnthropicThinkingMode(
	modelId: string,
	protocol: AnthropicThinkingProtocol | undefined,
): ThinkingControlMode {
	const required = resolveAnthropicThinkingProtocol(modelId) ?? protocol;
	return required === "legacy" ? "budget" : "anthropic-adaptive";
}

/**
 * 生成 OMP 的 thinking 配置：只改 mode（和缺失的 efforts），保留 effortMap /
 * defaultLevel / supportsDisplay 等原生字段。
 */
export function buildAnthropicThinkingConfig(
	existing: ModelThinkingConfig | undefined,
	modelId: string,
	protocol: AnthropicThinkingProtocol | undefined,
): ModelThinkingConfig {
	const mode = resolveAnthropicThinkingMode(modelId, protocol);
	const efforts = Array.isArray(existing?.efforts) && existing.efforts.length > 0
		? [...existing.efforts]
		: [...DEFAULT_THINKING_EFFORTS];
	return { ...(existing ?? {}), mode, efforts };
}

/**
 * 统一的 OMP thinking 配置构造：anthropic 走能力表，其它协议保持 effort/google-level。
 * 供保存、models.yml 同步和动态注册共用。
 */
export function buildModelThinkingConfig(
	api: string,
	modelId: string,
	reasoning: boolean,
	existing: ModelThinkingConfig | undefined,
): ModelThinkingConfig | undefined {
	if (!reasoning) return undefined;
	if (api === "anthropic-messages") {
		const protocol = resolveAnthropicThinkingProtocol(modelId) ?? resolveThinkingProtocolFromMode(existing?.mode);
		return buildAnthropicThinkingConfig(existing, modelId, protocol);
	}
	const efforts = Array.isArray(existing?.efforts) && existing.efforts.length > 0
		? [...existing.efforts]
		: [...DEFAULT_THINKING_EFFORTS];
	return {
		...(existing ?? {}),
		mode: api === "google-generative-ai" ? "google-level" : "effort",
		efforts,
	};
}

/** Pi 内置的 thinking 预算档位，用于把 budget_tokens 折回 effort。 */
const DEFAULT_THINKING_BUDGETS = { minimal: 1024, low: 2048, medium: 8192, high: 16384 } as const;

export function mapThinkingBudgetToEffort(budgetTokens: unknown): "low" | "medium" | "high" {
	const budget = typeof budgetTokens === "number" && Number.isFinite(budgetTokens)
		? budgetTokens
		: DEFAULT_THINKING_BUDGETS.minimal;
	if (budget <= DEFAULT_THINKING_BUDGETS.low) return "low";
	if (budget <= DEFAULT_THINKING_BUDGETS.medium) return "medium";
	return "high";
}

/**
 * 请求兜底：内存里的注册配置没有 thinking.mode 时，把必然 400 的 thinking 参数
 * 改写成能力表允许的形状。双模与未知模型保持原样。
 */
export function normalizeAnthropicThinkingPayload(payload: unknown, modelId: string): unknown | undefined {
	if (!isObjectRecord(payload)) return undefined;
	if (typeof payload.model === "string" && payload.model !== modelId) return undefined;
	const support = getAnthropicThinkingSupport(modelId);
	if (!support?.adaptive) return undefined;
	const thinking = isObjectRecord(payload.thinking) ? payload.thinking : undefined;
	if (!thinking) return undefined;

	if (thinking.type === "disabled") {
		if (!support.rejectsDisabled) return undefined;
		const next: Record<string, unknown> = { ...payload };
		delete next.thinking;
		return next;
	}
	if (thinking.type !== "enabled" || support.extended) return undefined;

	const { budget_tokens: budgetTokens, ...rest } = thinking;
	const next: Record<string, unknown> = { ...payload, thinking: { ...rest, type: "adaptive" } };
	if (!isObjectRecord(next.thinking) || !("display" in next.thinking)) {
		(next.thinking as Record<string, unknown>).display = "summarized";
	}
	const outputConfig = isObjectRecord(payload.output_config) ? payload.output_config : undefined;
	if (outputConfig?.effort === undefined) {
		next.output_config = { ...(outputConfig ?? {}), effort: mapThinkingBudgetToEffort(budgetTokens) };
	}
	return next;
}
