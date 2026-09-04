// thinkingLevelMap 的协议默认值与持久化归一化。

import type { ApiKind, ThinkingLevelMap } from "../types.ts";

export const DEFAULT_EXTENDED_THINKING_LEVEL_MAP: ThinkingLevelMap = {
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
	ultra: "ultra",
};

export const DEFAULT_OPENAI_THINKING_LEVEL_MAP: ThinkingLevelMap = {
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
	ultra: "ultra",
};

export const DEFAULT_GOOGLE_GENERATIVE_AI_THINKING_LEVEL_MAP: ThinkingLevelMap = {
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "high",
	max: "high",
	ultra: "ultra",
};

export const EXTENDED_THINKING_LEVEL_MAP = DEFAULT_EXTENDED_THINKING_LEVEL_MAP;
export const OPENAI_THINKING_LEVEL_MAP = DEFAULT_OPENAI_THINKING_LEVEL_MAP;
export const GOOGLE_GENERATIVE_AI_THINKING_LEVEL_MAP = DEFAULT_GOOGLE_GENERATIVE_AI_THINKING_LEVEL_MAP;

function isLegacyShiftedMaxLadder(map: ThinkingLevelMap): boolean {
	return map.minimal === "low"
		&& map.low === "medium"
		&& map.medium === "high"
		&& map.high === "xhigh"
		&& map.xhigh === "max"
		&& map.max === undefined;
}

function isLegacyGoogleLockedMap(map: ThinkingLevelMap): boolean {
	return map.minimal === "minimal"
		&& map.low === "low"
		&& map.medium === "medium"
		&& map.high === "high"
		&& map.xhigh === null
		&& map.max === null;
}

function isLegacyOpenAILockedMap(map: ThinkingLevelMap): boolean {
	return map.minimal === null
		&& map.low === "low"
		&& map.medium === "medium"
		&& map.high === "high"
		&& (map.xhigh === "xhigh" || map.xhigh === "high" || map.xhigh === undefined)
		&& (map.max === "max" || map.max === "high" || map.max === undefined);
}

export function buildThinkingLevelMap(api: ApiKind, reasoning: boolean): ThinkingLevelMap | undefined {
	if (!reasoning) return undefined;
	if (api === "google-generative-ai") return { ...DEFAULT_GOOGLE_GENERATIVE_AI_THINKING_LEVEL_MAP };
	if (api === "openai-completions" || api === "openai-responses") return { ...DEFAULT_OPENAI_THINKING_LEVEL_MAP };
	return { ...DEFAULT_EXTENDED_THINKING_LEVEL_MAP };
}

function mergeThinkingLevelMap(
	defaultMap: ThinkingLevelMap | undefined,
	storedMap: ThinkingLevelMap | undefined,
): ThinkingLevelMap | undefined {
	const merged = { ...(defaultMap ?? {}), ...(storedMap ?? {}) };
	return Object.keys(merged).length > 0 ? merged : undefined;
}

export function normalizeThinkingLevelMap(
	api: ApiKind,
	reasoning: boolean,
	storedMap: ThinkingLevelMap | undefined,
): ThinkingLevelMap | undefined {
	if (!reasoning) return undefined;
	const defaultMap = buildThinkingLevelMap(api, true);
	if (storedMap) {
		if (isLegacyShiftedMaxLadder(storedMap) || isLegacyGoogleLockedMap(storedMap) || isLegacyOpenAILockedMap(storedMap)) {
			return defaultMap;
		}
	}
	return mergeThinkingLevelMap(defaultMap, storedMap);
}
