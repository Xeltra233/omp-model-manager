// models-config-manager.ts
//
// 管理 OMP 的 ~/.omp/agent/models.yml 与 ~/.omp/agent/models.json：读 / 写 / 增 / 删 / 改。
//
// OMP 核心以 models.yml 为主配置文件，同时向下兼容 models.json。
// 本模块双写 models.yml 与 models.json，保持原子同步，使得 OMP 原生加载与外部工具均可获得一致配置。
// 写入后由调用方执行 ctx.modelRegistry.refresh()，完成 OMP 内存中模型目录的即时重载。

import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { join } from "node:path";
import { cloneJson, isObjectRecord, stringifyJson, stripJsonNoise } from "./common.ts";
import { readStableTextFileSnapshot, type FileSignature } from "./file-snapshot.ts";
import { t } from "./i18n.ts";
import type { TokenCost } from "./types.ts";
import { parseYaml, stringifyYaml } from "./yaml-utils.ts";

export const MODELS_YML_PATH = join(getAgentDir(), "models.yml");
export const MODELS_JSON_PATH = join(getAgentDir(), "models.json");

// ========== schema ==========

export interface ModelsConfigModelEntry {
	id: string;
	name?: string;
	api?: string;
	baseUrl?: string;
	reasoning?: boolean;
	thinkingLevelMap?: Record<string, string | null>;
	input?: ("text" | "image")[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: TokenCost;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface ModelsConfigProviderEntry {
	name?: string;
	baseUrl?: string;
	api?: string;
	apiKey?: string;
	authHeader?: boolean;
	headers?: Record<string, string>;
	models?: ModelsConfigModelEntry[];
	modelOverrides?: Record<string, unknown>;
	compat?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface ModelsConfigDocument {
	providers: Record<string, ModelsConfigProviderEntry>;
	[key: string]: unknown;
}

const PLUGIN_PROVIDER_METADATA_KEY = "ompModelManager";
const LEGACY_PLUGIN_PROVIDER_METADATA_KEY = "piModelManager";

export function hasPluginManagedProviderMarker(entry: ModelsConfigProviderEntry): boolean {
	const metadata = entry[PLUGIN_PROVIDER_METADATA_KEY];
	if (isObjectRecord(metadata) && metadata.managed === true) return true;
	const legacyMetadata = entry[LEGACY_PLUGIN_PROVIDER_METADATA_KEY];
	return isObjectRecord(legacyMetadata) && legacyMetadata.managed === true;
}

export function markProviderEntryAsPluginManaged(entry: ModelsConfigProviderEntry): ModelsConfigProviderEntry {
	const next = cloneJson(entry);
	const existingOmp = isObjectRecord(next[PLUGIN_PROVIDER_METADATA_KEY])
		? next[PLUGIN_PROVIDER_METADATA_KEY] as Record<string, unknown>
		: {};
	const existingPi = isObjectRecord(next[LEGACY_PLUGIN_PROVIDER_METADATA_KEY])
		? next[LEGACY_PLUGIN_PROVIDER_METADATA_KEY] as Record<string, unknown>
		: {};
	next[PLUGIN_PROVIDER_METADATA_KEY] = { ...existingOmp, managed: true };
	next[LEGACY_PLUGIN_PROVIDER_METADATA_KEY] = { ...existingPi, managed: true };
	return next;
}

export function markManagedProvidersInDoc(
	doc: ModelsConfigDocument,
	providerIds: readonly string[],
): ModelsConfigDocument {
	let next = doc;
	for (const providerId of providerIds) {
		const entry = next.providers[providerId];
		if (!entry || hasPluginManagedProviderMarker(entry)) continue;
		if (next === doc) next = cloneJson(doc);
		next.providers[providerId] = markProviderEntryAsPluginManaged(entry);
	}
	return next;
}

export interface ModelsConfigSnapshot {
	document: ModelsConfigDocument;
	source: string | undefined;
	format: "yaml" | "json" | "none";
	path: string;
	signature: FileSignature;
	contentHash: string;
}

// ========== IO ==========

function createEmpty(): ModelsConfigDocument {
	return { providers: {} };
}

function parseModelsConfig(source: string, format: "yaml" | "json"): ModelsConfigDocument {
	let parsed: unknown;
	if (format === "yaml") {
		try {
			parsed = parseYaml(source);
		} catch (error) {
			throw new Error(t("models.yml 语法错误：{error}", { error: String(error) }));
		}
	} else {
		try {
			parsed = JSON.parse(stripJsonNoise(source));
		} catch (error) {
			throw new Error(t("models.json 语法错误：{error}", { error: String(error) }));
		}
	}

	if (!parsed || !isObjectRecord(parsed)) {
		throw new Error(t("模型配置文件根节点必须是对象"));
	}
	const providers = isObjectRecord(parsed.providers) ? parsed.providers : {};
	return { ...parsed, providers: providers as Record<string, ModelsConfigProviderEntry> };
}

export async function readModelsConfigSnapshot(): Promise<ModelsConfigSnapshot> {
	// 优先读取 models.yml（OMP 主规范）
	const ymlSnapshot = await readStableTextFileSnapshot(MODELS_YML_PATH);
	if (ymlSnapshot.source !== undefined) {
		return {
			document: parseModelsConfig(ymlSnapshot.source, "yaml"),
			source: ymlSnapshot.source,
			format: "yaml",
			path: MODELS_YML_PATH,
			signature: ymlSnapshot.signature,
			contentHash: ymlSnapshot.contentHash,
		};
	}

	// 回退读取 models.json
	const jsonSnapshot = await readStableTextFileSnapshot(MODELS_JSON_PATH);
	if (jsonSnapshot.source !== undefined) {
		return {
			document: parseModelsConfig(jsonSnapshot.source, "json"),
			source: jsonSnapshot.source,
			format: "json",
			path: MODELS_JSON_PATH,
			signature: jsonSnapshot.signature,
			contentHash: jsonSnapshot.contentHash,
		};
	}

	return {
		document: createEmpty(),
		source: undefined,
		format: "none",
		path: MODELS_YML_PATH,
		signature: ymlSnapshot.signature,
		contentHash: ymlSnapshot.contentHash,
	};
}

export function serializeModelsYaml(doc: ModelsConfigDocument): string {
	return stringifyYaml(doc);
}

export function serializeModelsJson(doc: ModelsConfigDocument): string {
	return stringifyJson(doc);
}

export function getModelsYmlPath(): string {
	return MODELS_YML_PATH;
}

export function getModelsJsonPath(): string {
	return MODELS_JSON_PATH;
}

// ========== 文档操作（纯函数，深拷贝后改） ==========

export function setProviderInDoc(
	doc: ModelsConfigDocument,
	providerId: string,
	entry: ModelsConfigProviderEntry,
): ModelsConfigDocument {
	const next = cloneJson(doc);
	next.providers[providerId] = entry;
	return next;
}

export function deleteProviderInDoc(doc: ModelsConfigDocument, providerId: string): ModelsConfigDocument {
	const next = cloneJson(doc);
	delete next.providers[providerId];
	return next;
}

export function renameProviderInDoc(
	doc: ModelsConfigDocument,
	oldProviderId: string,
	newProviderId: string,
): ModelsConfigDocument {
	const next = cloneJson(doc);
	if (oldProviderId === newProviderId) return next;
	const source = next.providers[oldProviderId];
	if (!source) throw new Error(t("模型配置中不存在待重命名接入：{providerId}", { providerId: oldProviderId }));
	if (next.providers[newProviderId]) throw new Error(t("模型配置中已存在接入：{providerId}", { providerId: newProviderId }));
	next.providers[newProviderId] = source;
	delete next.providers[oldProviderId];
	return next;
}

export function setModelInDoc(
	doc: ModelsConfigDocument,
	providerId: string,
	model: ModelsConfigModelEntry,
	replacedModelId?: string,
): ModelsConfigDocument {
	const next = cloneJson(doc);
	const provider = next.providers[providerId];
	if (!provider) throw new Error(t("模型配置中不存在接入：{providerId}", { providerId }));
	let replaced = false;
	const models = (provider.models ?? []).flatMap((current) => {
		if (current.id !== model.id && current.id !== replacedModelId) return [current];
		if (replaced) return [];
		replaced = true;
		return [model];
	});
	if (!replaced) models.push(model);
	provider.models = models;
	return next;
}

export function renameModelInDoc(
	doc: ModelsConfigDocument,
	providerId: string,
	oldModelId: string,
	newModelId: string,
): ModelsConfigDocument {
	const next = cloneJson(doc);
	if (oldModelId === newModelId) return next;
	const provider = next.providers[providerId];
	if (!provider) throw new Error(t("模型配置中不存在接入：{providerId}", { providerId }));
	const models = provider.models ?? [];
	const source = models.find((model) => model.id === oldModelId);
	if (!source) throw new Error(t("模型配置中不存在待重命名模型：{fullId}", { fullId: `${providerId}/${oldModelId}` }));
	if (models.some((model) => model.id === newModelId)) {
		throw new Error(t("模型配置中已存在模型：{fullId}", { fullId: `${providerId}/${newModelId}` }));
	}
	source.id = newModelId;
	return next;
}

export function deleteModelInDoc(
	doc: ModelsConfigDocument,
	providerId: string,
	modelId: string,
): ModelsConfigDocument {
	const next = cloneJson(doc);
	const provider = next.providers[providerId];
	if (!provider) return next;
	provider.models = (provider.models ?? []).filter((m) => m.id !== modelId);
	return next;
}
