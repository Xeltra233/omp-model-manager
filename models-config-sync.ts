// models-config-sync.ts
//
// 将插件自有 state 中的接入/模型同步到 OMP 原生配置：
// - models.yml 与 models.json 双向原子同步，供 /model、--models、omp models 等原生路径读取。
// - settings.json 的 enabledModels 只在用户已经启用模型范围过滤时追加新模型；未配置时保持“全部启用”。

import {
	CONFIG_DIR_NAME,
	getAgentDir,
	type ExtensionCommandContext,
} from "@oh-my-pi/pi-coding-agent";
import { createRequire } from "node:module";
import { join } from "node:path";
import { minimatch } from "minimatch";
import { atomicWriteText } from "./atomic-write.ts";
import { cloneJson, formatUnknownError, isObjectRecord, stringifyJson, stripJsonNoise } from "./common.ts";
import { withConfigurationLock } from "./configuration-lock.ts";
import { readStableTextFileSnapshot } from "./file-snapshot.ts";
import { t } from "./i18n.ts";
import {
	deleteModelInDoc,
	deleteProviderInDoc,
	markProviderEntryAsPluginManaged,
	setModelInDoc,
	setProviderInDoc,
	type ModelsConfigDocument,
	type ModelsConfigModelEntry,
	type ModelsConfigProviderEntry,
} from "./models-config-manager.ts";
import { buildModelRequestHeaders } from "./provider-registrar.ts";
import { ALL_THINKING_LEVELS } from "./types.ts";
import type {
	BuiltInClientHeaderProfileId,
	StateDocument,
	StoredClientHeaderCapture,
	StoredModel,
	StoredProvider,
	StoredRequestHeaderProfile,
} from "./types.ts";

const THINKING_LEVELS = new Set<string>(ALL_THINKING_LEVELS);

export interface NativeModelVerification {
	ok: boolean;
	warnings: string[];
}

export interface EnabledModelUpdate {
	mode: "all-enabled" | "updated" | "unchanged";
	scope?: "global" | "project";
}

function copyRecord(value: unknown): Record<string, unknown> | undefined {
	return isObjectRecord(value) ? cloneJson(value) : undefined;
}

function copyStringRecord(value: unknown): Record<string, string> | undefined {
	if (!isObjectRecord(value)) return undefined;
	const record: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item === "string") record[key] = item;
	}
	return Object.keys(record).length > 0 ? record : undefined;
}

function copyCost(value: StoredModel["cost"]): ModelsConfigModelEntry["cost"] {
	return cloneJson(value);
}

function copyInput(value: StoredModel["input"]): ModelsConfigModelEntry["input"] {
	return [...value];
}

function buildModelsConfigModelEntry(
	provider: StoredProvider,
	model: StoredModel,
	requestHeaderProfiles: Record<string, StoredRequestHeaderProfile>,
	clientHeaderCaptures: Partial<Record<BuiltInClientHeaderProfileId, StoredClientHeaderCapture>>,
	existing?: ModelsConfigModelEntry,
): ModelsConfigModelEntry {
	const entry: ModelsConfigModelEntry = existing ? cloneJson(existing) : { id: model.id };
	entry.id = model.id;
	if (model.name?.trim()) entry.name = model.name.trim();
	else delete entry.name;
	if (model.api) entry.api = model.api;
	else delete entry.api;
	if (model.baseUrl) entry.baseUrl = model.baseUrl;
	else delete entry.baseUrl;
	entry.reasoning = model.reasoning;
	if (model.thinkingLevelMap && Object.keys(model.thinkingLevelMap).length > 0) {
		const map: Record<string, string | null> = {};
		for (const [level, mapped] of Object.entries(model.thinkingLevelMap)) {
			if (THINKING_LEVELS.has(level)) map[level] = mapped;
		}
		if (Object.keys(map).length > 0) entry.thinkingLevelMap = map;
		else delete entry.thinkingLevelMap;
	} else {
		delete entry.thinkingLevelMap;
	}
	entry.input = copyInput(model.input);
	entry.contextWindow = model.contextWindow;
	entry.maxTokens = model.maxTokens;
	entry.cost = copyCost(model.cost);
	const headers = buildModelRequestHeaders(provider, model, requestHeaderProfiles, clientHeaderCaptures);
	if (headers && Object.keys(headers).length > 0) entry.headers = headers;
	else delete entry.headers;
	if (model.compat && Object.keys(model.compat).length > 0) entry.compat = copyRecord(model.compat);
	else delete entry.compat;
	return entry;
}

function buildModelsConfigProviderEntry(
	provider: StoredProvider,
	requestHeaderProfiles: Record<string, StoredRequestHeaderProfile>,
	clientHeaderCaptures: Partial<Record<BuiltInClientHeaderProfileId, StoredClientHeaderCapture>>,
	existing?: ModelsConfigProviderEntry,
): ModelsConfigProviderEntry {
	const entry: ModelsConfigProviderEntry = existing ? cloneJson(existing) : {};
	if (provider.name?.trim()) entry.name = provider.name.trim();
	else delete entry.name;
	entry.baseUrl = provider.baseUrl;
	entry.api = provider.api;
	if (provider.apiKey?.trim()) entry.apiKey = provider.apiKey.trim();
	else delete entry.apiKey;
	if (provider.authHeader) entry.authHeader = true;
	else delete entry.authHeader;
	if (provider.compat && Object.keys(provider.compat).length > 0) entry.compat = copyRecord(provider.compat);
	else delete entry.compat;
	if (provider.modelOverrides && Object.keys(provider.modelOverrides).length > 0) {
		entry.modelOverrides = copyRecord(provider.modelOverrides);
	} else {
		delete entry.modelOverrides;
	}
	if (provider.headers && Object.keys(provider.headers).length > 0) {
		entry.headers = copyStringRecord(provider.headers);
	} else {
		delete entry.headers;
	}
	const existingModels = new Map((existing?.models ?? []).map((model) => [model.id, model]));
	entry.models = provider.models.map((model) =>
		buildModelsConfigModelEntry(
			provider,
			model,
			requestHeaderProfiles,
			clientHeaderCaptures,
			existingModels.get(model.id),
		)
	);
	return markProviderEntryAsPluginManaged(entry);
}

export function syncProviderToModelsConfigDoc(
	doc: ModelsConfigDocument,
	providerId: string,
	provider: StoredProvider,
	requestHeaderProfiles: Record<string, StoredRequestHeaderProfile>,
	clientHeaderCaptures: Partial<Record<BuiltInClientHeaderProfileId, StoredClientHeaderCapture>>,
): ModelsConfigDocument {
	const entry = buildModelsConfigProviderEntry(
		provider,
		requestHeaderProfiles,
		clientHeaderCaptures,
		doc.providers[providerId],
	);
	return setProviderInDoc(doc, providerId, entry);
}

export function syncModelToModelsConfigDoc(
	doc: ModelsConfigDocument,
	providerId: string,
	provider: StoredProvider,
	model: StoredModel,
	requestHeaderProfiles: Record<string, StoredRequestHeaderProfile>,
	clientHeaderCaptures: Partial<Record<BuiltInClientHeaderProfileId, StoredClientHeaderCapture>>,
	replacedModelId?: string,
): ModelsConfigDocument {
	const existingProvider = doc.providers[providerId];
	const existingModel = (existingProvider?.models ?? []).find((m) => m.id === model.id || m.id === replacedModelId);
	const modelEntry = buildModelsConfigModelEntry(
		provider,
		model,
		requestHeaderProfiles,
		clientHeaderCaptures,
		existingModel,
	);
	let nextDoc = setModelInDoc(doc, providerId, modelEntry, replacedModelId);
	const updatedProvider = nextDoc.providers[providerId];
	if (updatedProvider) {
		const refreshed = buildModelsConfigProviderEntry(
			provider,
			requestHeaderProfiles,
			clientHeaderCaptures,
			updatedProvider,
		);
		nextDoc = setProviderInDoc(nextDoc, providerId, refreshed);
	}
	return nextDoc;
}

export function removeProviderFromModelsConfigDoc(doc: ModelsConfigDocument, providerId: string): ModelsConfigDocument {
	return deleteProviderInDoc(doc, providerId);
}

export function removeModelFromModelsConfigDoc(
	doc: ModelsConfigDocument,
	providerId: string,
	modelId: string,
): ModelsConfigDocument {
	const nextDoc = deleteModelInDoc(doc, providerId, modelId);
	const provider = nextDoc.providers[providerId];
	if (provider && (!provider.models || provider.models.length === 0)) {
		return deleteProviderInDoc(nextDoc, providerId);
	}
	return nextDoc;
}

export function syncStateDocumentToModelsConfigDoc(
	doc: ModelsConfigDocument,
	state: StateDocument,
): ModelsConfigDocument {
	let next = doc;
	for (const [providerId, provider] of Object.entries(state.providers)) {
		if (!provider.managed) continue;
		next = syncProviderToModelsConfigDoc(
			next,
			providerId,
			provider,
			state.requestHeaderProfiles,
			state.clientHeaderCaptures,
		);
	}
	for (const providerId of Object.keys(next.providers)) {
		const inState = state.providers[providerId];
		if (!inState && state.managedProviderIds.includes(providerId)) {
			next = removeProviderFromModelsConfigDoc(next, providerId);
		}
	}
	return next;
}

export function buildSynchronizedModelsDocument(
	document: StateDocument,
	sourceDocument: ModelsConfigDocument,
	removedProviderIds: readonly string[] = [],
	changedProviderIds: readonly string[] = document.managedProviderIds,
): ModelsConfigDocument {
	let nextDocument = sourceDocument;
	for (const providerId of removedProviderIds) {
		nextDocument = deleteProviderInDoc(nextDocument, providerId);
	}
	for (const providerId of changedProviderIds) {
		const provider = document.providers[providerId];
		if (!provider || provider.models.length === 0) {
			nextDocument = deleteProviderInDoc(nextDocument, providerId);
			continue;
		}
		const entry = buildModelsConfigProviderEntry(
			provider,
			document.requestHeaderProfiles,
			document.clientHeaderCaptures,
			nextDocument.providers[providerId],
		);
		nextDocument = setProviderInDoc(nextDocument, providerId, entry);
	}
	return nextDocument;
}

export function buildModelsDocumentWithSynchronizedModel(
	document: StateDocument,
	sourceDocument: ModelsConfigDocument,
	providerId: string,
	modelId: string,
	replacedModelId?: string,
): ModelsConfigDocument {
	const provider = document.providers[providerId];
	if (!provider) throw new Error(t("接入不存在：{providerId}", { providerId }));
	const model = provider.models.find((candidate) => candidate.id === modelId);
	if (!model) throw new Error(t("模型不存在：{fullId}", { fullId: `${providerId}/${modelId}` }));
	const sourceModel = sourceDocument.providers[providerId]?.models?.find(
		(candidate) => candidate.id === modelId || candidate.id === replacedModelId,
	);
	const entry = buildModelsConfigModelEntry(
		provider,
		model,
		document.requestHeaderProfiles,
		document.clientHeaderCaptures,
		sourceModel,
	);
	return setModelInDoc(sourceDocument, providerId, entry, replacedModelId);
}

export function buildModelsDocumentWithoutModel(
	document: StateDocument,
	sourceDocument: ModelsConfigDocument,
	providerId: string,
	modelId: string,
): ModelsConfigDocument {
	return document.providers[providerId]
		? deleteModelInDoc(sourceDocument, providerId, modelId)
		: deleteProviderInDoc(sourceDocument, providerId);
}

// ========== enabledModels 同步 ==========

function splitThinkingSuffix(pattern: string): { base: string; suffix: string } {
	const index = pattern.lastIndexOf(":");
	if (index < 0) return { base: pattern, suffix: "" };
	const maybeLevel = pattern.slice(index + 1);
	if (!THINKING_LEVELS.has(maybeLevel)) return { base: pattern, suffix: "" };
	return { base: pattern.slice(0, index), suffix: pattern.slice(index) };
}

function matchesExistingModelPattern(pattern: string, fullModelId: string): boolean {
	const { base } = splitThinkingSuffix(pattern);
	return minimatch(fullModelId.toLowerCase(), base.toLowerCase());
}

function dedupeModelPatterns(patterns: readonly string[]): string[] {
	return [...new Set(patterns)];
}

function upsertEnabledModelPattern(
	patterns: string[],
	fullModelId: string,
	replacedFullModelId?: string,
): string[] {
	if (replacedFullModelId && replacedFullModelId !== fullModelId) {
		const replacedLower = replacedFullModelId.toLowerCase();
		let replaced = false;
		const updated = patterns.map((pattern) => {
			const { base, suffix } = splitThinkingSuffix(pattern);
			if (base.toLowerCase() !== replacedLower) return pattern;
			replaced = true;
			return `${fullModelId}${suffix}`;
		});
		if (replaced) return dedupeModelPatterns(updated);
	}
	if (patterns.some((pattern) => matchesExistingModelPattern(pattern, fullModelId))) {
		return patterns;
	}
	return [...patterns, fullModelId];
}

function removeEnabledModelPatterns(patterns: string[], fullModelIds: readonly string[]): string[] {
	const targets = new Set(fullModelIds.map((id) => id.toLowerCase()));
	return patterns.filter((pattern) => !targets.has(splitThinkingSuffix(pattern).base.toLowerCase()));
}

function removeEnabledProviderPatterns(patterns: string[], providerId: string): string[] {
	const providerPrefix = `${providerId}/`.toLowerCase();
	return patterns.filter((pattern) => !splitThinkingSuffix(pattern).base.toLowerCase().startsWith(providerPrefix));
}

interface SettingsFileLock {
	lock(path: string, options: {
		realpath: false;
		retries: { retries: number; factor: number; minTimeout: number; maxTimeout: number };
	}): Promise<() => Promise<void>>;
}

const require = createRequire(import.meta.url);
const settingsFileLock = require("proper-lockfile") as SettingsFileLock;

interface LockedSettingsUpdate {
	configured: boolean;
	outcome: EnabledModelUpdate;
}

async function updateLockedSettings(
	path: string,
	scope: "global" | "project",
	update: (patterns: string[]) => string[],
): Promise<LockedSettingsUpdate> {
	const initialSnapshot = await readStableTextFileSnapshot(path);
	if (initialSnapshot.source === undefined) {
		return { configured: false, outcome: { mode: "all-enabled" } };
	}
	const release = await settingsFileLock.lock(path, {
		realpath: false,
		retries: { retries: 10, factor: 1, minTimeout: 20, maxTimeout: 20 },
	});
	try {
		const snapshot = await readStableTextFileSnapshot(path);
		const settings = snapshot.source === undefined ? {} : JSON.parse(stripJsonNoise(snapshot.source));
		if (!isObjectRecord(settings)) throw new Error(t("{path} 根节点必须是对象", { path }));
		const current = settings.enabledModels;
		if (!Array.isArray(current)) return { configured: false, outcome: { mode: "all-enabled" } };
		const patterns = current.filter((item): item is string => typeof item === "string");
		if (patterns.length === 0) return { configured: true, outcome: { mode: "all-enabled" } };
		const next = update(patterns);
		if (JSON.stringify(next) === JSON.stringify(patterns)) {
			return { configured: true, outcome: { mode: "unchanged", scope } };
		}
		const currentSnapshot = await readStableTextFileSnapshot(path);
		if (currentSnapshot.contentHash !== snapshot.contentHash) {
			throw new Error(t("{path} 已被未遵守 OMP 文件锁的编辑器修改；已取消 enabledModels 同步，请重试。", { path }));
		}
		settings.enabledModels = next;
		await atomicWriteText(path, stringifyJson(settings));
		return { configured: true, outcome: { mode: "updated", scope } };
	} finally {
		await release();
	}
}

async function updateEnabledModelsForNextOmpStart(
	cwd: string,
	update: (patterns: string[]) => string[],
): Promise<EnabledModelUpdate> {
	const projectDirs = [join(cwd, CONFIG_DIR_NAME), join(cwd, ".omp"), join(cwd, ".pi")];
	const uniqueProjectDirs = [...new Set(projectDirs)];
	for (const dir of uniqueProjectDirs) {
		const projectUpdate = await updateLockedSettings(join(dir, "settings.json"), "project", update);
		if (projectUpdate.configured) return projectUpdate.outcome;
	}
	return (await updateLockedSettings(join(getAgentDir(), "settings.json"), "global", update)).outcome;
}

export async function enableModelForNextOmpStart(
	cwd: string,
	fullModelId: string,
	replacedFullModelId?: string,
): Promise<EnabledModelUpdate> {
	return withConfigurationLock(() => updateEnabledModelsForNextOmpStart(
		cwd,
		(patterns) => upsertEnabledModelPattern(patterns, fullModelId, replacedFullModelId),
	));
}

export const enableModelForNextPiStart = enableModelForNextOmpStart;

export async function removeModelFromNextOmpStart(cwd: string, fullModelId: string): Promise<EnabledModelUpdate> {
	return withConfigurationLock(() => updateEnabledModelsForNextOmpStart(
		cwd,
		(patterns) => removeEnabledModelPatterns(patterns, [fullModelId]),
	));
}

export const removeModelFromNextPiStart = removeModelFromNextOmpStart;

export async function removeProviderFromNextOmpStart(cwd: string, providerId: string): Promise<EnabledModelUpdate> {
	return withConfigurationLock(() => updateEnabledModelsForNextOmpStart(
		cwd,
		(patterns) => removeEnabledProviderPatterns(patterns, providerId),
	));
}

export const removeProviderFromNextPiStart = removeProviderFromNextOmpStart;

function replaceEnabledProviderPatterns(
	patterns: string[],
	oldProviderId: string,
	newProviderId: string,
): string[] {
	const oldPrefix = `${oldProviderId}/`;
	let changed = false;
	const next = patterns.map((pattern) => {
		const { base, suffix } = splitThinkingSuffix(pattern);
		if (!base.toLowerCase().startsWith(oldPrefix.toLowerCase())) return pattern;
		changed = true;
		return `${newProviderId}/${base.slice(oldPrefix.length)}${suffix}`;
	});
	return changed ? dedupeModelPatterns(next) : patterns;
}

export async function replaceProviderInEnabledModelsForNextOmpStart(
	cwd: string,
	oldProviderId: string,
	newProviderId: string,
): Promise<EnabledModelUpdate> {
	return withConfigurationLock(() => updateEnabledModelsForNextOmpStart(
		cwd,
		(patterns) => replaceEnabledProviderPatterns(patterns, oldProviderId, newProviderId),
	));
}

export const replaceProviderInEnabledModelsForNextPiStart = replaceProviderInEnabledModelsForNextOmpStart;

// ========== 原生模型可用性校验 ==========

async function verifyRegistryModel(
	label: string,
	registry: any,
	providerId: string,
	modelId: string,
): Promise<string[]> {
	const warnings: string[] = [];
	if (!registry || typeof registry.find !== "function") return warnings;
	const model = registry.find(providerId, modelId);
	if (!model) {
		warnings.push(t("{label} 未找到模型 {fullId}", { label, fullId: `${providerId}/${modelId}` }));
		return warnings;
	}
	if (typeof registry.hasConfiguredAuth === "function" && !registry.hasConfiguredAuth(model)) {
		warnings.push(t("{label} 找到模型 {fullId}，但 API key 未配置或不可解析", { label, fullId: `${providerId}/${modelId}` }));
		return warnings;
	}
	if (typeof registry.getApiKeyAndHeaders === "function") {
		try {
			const auth = await registry.getApiKeyAndHeaders(model);
			if (auth && !auth.ok && auth.error) {
				warnings.push(t("{label} 请求认证解析失败：{error}", { label, error: auth.error }));
			}
		} catch (error) {
			warnings.push(t("{label} 请求认证解析失败：{error}", { label, error: formatUnknownError(error) }));
		}
	}
	return warnings;
}

export async function verifyNativeModelAvailable(
	ctx: ExtensionCommandContext,
	providerId: string,
	modelId: string,
): Promise<NativeModelVerification> {
	const warnings: string[] = [];
	if (ctx?.modelRegistry) {
		warnings.push(...await verifyRegistryModel(t("当前会话 registry"), ctx.modelRegistry, providerId, modelId));
	}
	try {
		const codingAgent = await import("@oh-my-pi/pi-coding-agent").catch(() => null);
		const ModelRuntimeClass = (codingAgent as any)?.ModelRuntime;
		const ModelRegistryClass = (codingAgent as any)?.ModelRegistry;
		if (ModelRuntimeClass && ModelRegistryClass) {
			const agentDir = getAgentDir();
			const ymlSnapshot = await readStableTextFileSnapshot(join(agentDir, "models.yml"));
			const modelsPath = ymlSnapshot.source !== undefined ? join(agentDir, "models.yml") : join(agentDir, "models.json");
			const runtime = await ModelRuntimeClass.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath,
				allowModelNetwork: false,
			});
			const registry = new ModelRegistryClass(runtime);
			const label = modelsPath.endsWith(".yml") ? t("原生 models.yml registry") : t("原生 models.json registry");
			warnings.push(...await verifyRegistryModel(label, registry, providerId, modelId));
		}
	} catch (error) {
		warnings.push(t("原生 models 校验失败：{error}", { error: formatUnknownError(error) }));
	}
	return { ok: warnings.length === 0, warnings };
}
