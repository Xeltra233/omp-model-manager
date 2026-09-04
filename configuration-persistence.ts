// configuration-persistence.ts
//
// 模型管理保存边界：锁内重读最新 models.yml/models.json/state.json，目标化应用 mutation，
// 再以可恢复事务写入双格式文件与元数据。registry 刷新在释放文件锁后执行。

import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";

// 保存后只需要刷新模型 registry，不依赖命令上下文的其余能力；
// 声明成最小契约，session_start 的 ExtensionContext 也能直接复用这些函数。
type RegistryRefreshContext = Pick<ExtensionContext, "modelRegistry">;

import { unlink } from "node:fs/promises";
import { atomicWriteText } from "./atomic-write.ts";
import { formatUnknownError, isObjectRecord, stringifyJson } from "./common.ts";
import { withConfigurationLock } from "./configuration-lock.ts";
import { hashTextContent, readStableTextFileSnapshot } from "./file-snapshot.ts";
import { t } from "./i18n.ts";
import {
	MODELS_JSON_PATH,
	MODELS_YML_PATH,
	markManagedProvidersInDoc,
	readModelsConfigSnapshot,
	renameModelInDoc,
	renameProviderInDoc,
	serializeModelsJson,
	serializeModelsYaml,
	type ModelsConfigDocument,
} from "./models-config-manager.ts";
import {
	buildModelsDocumentWithSynchronizedModel,
	buildModelsDocumentWithoutModel,
	buildSynchronizedModelsDocument,
} from "./models-config-sync.ts";
import { invalidateStateCache } from "./state-cache.ts";
import {
	CONFIGURATION_TRANSACTION_PATH,
	STATE_PATH,
	readMetadataStateSnapshot,
	serializeMetadataState,
} from "./state-metadata-store.ts";
import { buildStateDocumentFromSources } from "./state-store.ts";
import type { StateDocument } from "./types.ts";

interface PreparedConfigurationChange {
	document: StateDocument;
	changedProviderIds: string[];
	removedProviderIds: string[];
}

export type PrepareConfigurationChange = (latest: StateDocument) => PreparedConfigurationChange;

interface FileTransition {
	oldSource: string | null;
	oldHash: string;
	targetSource: string;
	targetHash: string;
}

interface ConfigurationTransactionJournal {
	version: 1;
	createdAt: string;
	modelsYml?: FileTransition;
	modelsJson?: FileTransition;
	metadataState: FileTransition;
}
const TRANSACTION_PATH = CONFIGURATION_TRANSACTION_PATH;

function getErrorCode(error: unknown): string | undefined {
	return error instanceof Error && "code" in error
		? String((error as NodeJS.ErrnoException).code)
		: undefined;
}

function createTransition(oldSource: string | undefined, targetSource: string): FileTransition {
	return {
		oldSource: oldSource ?? null,
		oldHash: hashTextContent(oldSource),
		targetSource,
		targetHash: hashTextContent(targetSource),
	};
}

function readTransition(raw: unknown, path: string): FileTransition {
	if (!isObjectRecord(raw)) throw new Error(t("{path} 必须是对象", { path }));
	const oldSource = raw.oldSource;
	const oldHash = raw.oldHash;
	const targetSource = raw.targetSource;
	const targetHash = raw.targetHash;
	if (typeof oldSource !== "string" && oldSource !== null) {
		throw new Error(t("{path}.oldSource 必须是字符串或 null", { path }));
	}
	if (typeof oldHash !== "string" || typeof targetSource !== "string" || typeof targetHash !== "string") {
		throw new Error(t("{path} 缺少有效内容或签名", { path }));
	}
	if (oldHash !== hashTextContent(oldSource ?? undefined) || targetHash !== hashTextContent(targetSource)) {
		throw new Error(t("{path} 内容签名校验失败", { path }));
	}
	return { oldSource, oldHash, targetSource, targetHash };
}

function parseTransactionJournal(source: string): ConfigurationTransactionJournal {
	const raw = JSON.parse(source) as unknown;
	if (!isObjectRecord(raw) || raw.version !== 1 || typeof raw.createdAt !== "string") {
		throw new Error(t("事务意图文件格式无效"));
	}
	const modelsJson = raw.modelsJson ? readTransition(raw.modelsJson, "modelsJson") : undefined;
	const modelsYml = raw.modelsYml ? readTransition(raw.modelsYml, "modelsYml") : undefined;
	const metadataState = readTransition(raw.metadataState, "metadataState");
	return {
		version: 1,
		createdAt: raw.createdAt,
		...(modelsYml ? { modelsYml } : {}),
		...(modelsJson ? { modelsJson } : {}),
		metadataState,
	};
}
async function removeTransactionJournal(): Promise<void> {
	try {
		await unlink(TRANSACTION_PATH);
	} catch (error) {
		if (getErrorCode(error) !== "ENOENT") throw error;
	}
}

async function classifyTransition(path: string, transition: FileTransition): Promise<"old" | "target"> {
	const current = await readStableTextFileSnapshot(path);
	if (current.contentHash === transition.targetHash) return "target";
	if (current.contentHash === transition.oldHash) return "old";
	throw new Error(t("{path} 的当前内容既不是事务旧版本，也不是目标版本；已保留 {transactionPath}，不会覆盖外部修改。", { path, transactionPath: TRANSACTION_PATH }));
}

async function finishTransition(path: string, transition: FileTransition, status: "old" | "target"): Promise<void> {
	if (status === "old") await atomicWriteText(path, transition.targetSource);
	const completed = await readStableTextFileSnapshot(path);
	if (completed.contentHash !== transition.targetHash) {
		throw new Error(t("{path} 写入后内容签名不匹配；已保留 {transactionPath} 供恢复。", { path, transactionPath: TRANSACTION_PATH }));
	}
}

async function recoverPendingConfigurationTransactionInsideLock(): Promise<boolean> {
	const journalSnapshot = await readStableTextFileSnapshot(TRANSACTION_PATH);
	if (journalSnapshot.source === undefined) return false;
	let journal: ConfigurationTransactionJournal;
	try {
		journal = parseTransactionJournal(journalSnapshot.source);
	} catch (error) {
		throw new Error(t("无法解析未完成事务 {transactionPath}：{error}", { transactionPath: TRANSACTION_PATH, error: formatUnknownError(error) }));
	}

	if (journal.modelsYml) {
		const ymlStatus = await classifyTransition(MODELS_YML_PATH, journal.modelsYml);
		await finishTransition(MODELS_YML_PATH, journal.modelsYml, ymlStatus);
	}
	if (journal.modelsJson) {
		const jsonStatus = await classifyTransition(MODELS_JSON_PATH, journal.modelsJson);
		await finishTransition(MODELS_JSON_PATH, journal.modelsJson, jsonStatus);
	}
	const metadataStatus = await classifyTransition(STATE_PATH, journal.metadataState);
	await finishTransition(STATE_PATH, journal.metadataState, metadataStatus);
	await removeTransactionJournal();
	invalidateStateCache();
	return true;
}

export async function recoverPendingConfigurationTransaction(): Promise<boolean> {
	return withConfigurationLock(recoverPendingConfigurationTransactionInsideLock);
}

async function assertSnapshotStillCurrent(path: string, expectedHash: string): Promise<void> {
	const current = await readStableTextFileSnapshot(path);
	if (current.contentHash !== expectedHash) {
		throw new Error(t("{path} 已被其它进程或编辑器修改；已取消本次保存，请重新打开 /omp-model-manager 后重试。", { path }));
	}
}

async function writeConfigurationTransaction(
	modelsSnapshot: Awaited<ReturnType<typeof readModelsConfigSnapshot>>,
	metadataSnapshot: Awaited<ReturnType<typeof readMetadataStateSnapshot>>,
	modelsYmlTarget: string | null,
	modelsJsonTarget: string | null,
	nextState: StateDocument,
): Promise<void> {
	const ymlSnapshot = await readStableTextFileSnapshot(MODELS_YML_PATH);
	const jsonSnapshot = await readStableTextFileSnapshot(MODELS_JSON_PATH);
	const metadataTarget = serializeMetadataState(nextState);

	const journal: ConfigurationTransactionJournal = {
		version: 1,
		createdAt: new Date().toISOString(),
		...(modelsYmlTarget !== null ? { modelsYml: createTransition(ymlSnapshot.source, modelsYmlTarget) } : {}),
		...(modelsJsonTarget !== null ? { modelsJson: createTransition(jsonSnapshot.source, modelsJsonTarget) } : {}),
		metadataState: createTransition(metadataSnapshot.source, metadataTarget),
	};

	const checks = [
		assertSnapshotStillCurrent(STATE_PATH, metadataSnapshot.contentHash),
	];
	if (journal.modelsYml) checks.push(assertSnapshotStillCurrent(MODELS_YML_PATH, ymlSnapshot.contentHash));
	if (journal.modelsJson) checks.push(assertSnapshotStillCurrent(MODELS_JSON_PATH, jsonSnapshot.contentHash));
	await Promise.all(checks);
	await atomicWriteText(TRANSACTION_PATH, stringifyJson(journal));

	try {
		if (journal.modelsYml) {
			const ymlStatus = await classifyTransition(MODELS_YML_PATH, journal.modelsYml);
			await finishTransition(MODELS_YML_PATH, journal.modelsYml, ymlStatus);
		}
		if (journal.modelsJson) {
			const jsonStatus = await classifyTransition(MODELS_JSON_PATH, journal.modelsJson);
			await finishTransition(MODELS_JSON_PATH, journal.modelsJson, jsonStatus);
		}
		const metadataStatus = await classifyTransition(STATE_PATH, journal.metadataState);
		await finishTransition(STATE_PATH, journal.metadataState, metadataStatus);
		await removeTransactionJournal();
	} catch (error) {
		throw new Error(t("配置事务未完成：{error}。下次启动或保存会尝试恢复。", { error: formatUnknownError(error) }));
	}
}

type ModelsDocumentMutation = (
	source: ModelsConfigDocument,
	change: PreparedConfigurationChange,
) => ModelsConfigDocument;

async function persistConfigurationInsideLock(
	prepare: PrepareConfigurationChange,
	mutateModels: ModelsDocumentMutation,
): Promise<StateDocument> {
	await recoverPendingConfigurationTransactionInsideLock();
	const [modelsSnapshot, metadataSnapshot] = await Promise.all([
		readModelsConfigSnapshot(),
		readMetadataStateSnapshot(),
	]);
	const latest = await buildStateDocumentFromSources(modelsSnapshot.document, metadataSnapshot);
	const sourceWithOwnershipMarkers = metadataSnapshot.requirePluginManagedProviderMarker
		? modelsSnapshot.document
		: markManagedProvidersInDoc(modelsSnapshot.document, latest.managedProviderIds);
	const sourceWithLegacyProviders = buildSynchronizedModelsDocument(
		latest,
		sourceWithOwnershipMarkers,
		[],
		Object.keys(metadataSnapshot.legacyProviders),
	);
	const change = prepare(latest);
	const nextModels = mutateModels(sourceWithLegacyProviders, change);

	const [ymlSnapshot, jsonSnapshot] = await Promise.all([
		readStableTextFileSnapshot(MODELS_YML_PATH),
		readStableTextFileSnapshot(MODELS_JSON_PATH),
	]);
	const modelsUnchanged = nextModels === modelsSnapshot.document;
	const modelsYmlTarget = modelsUnchanged && ymlSnapshot.source !== undefined
		? ymlSnapshot.source
		: (modelsUnchanged && ymlSnapshot.source === undefined ? null : serializeModelsYaml(nextModels));
	const modelsJsonTarget = modelsUnchanged && jsonSnapshot.source !== undefined
		? jsonSnapshot.source
		: serializeModelsJson(nextModels);

	await writeConfigurationTransaction(
		modelsSnapshot,
		metadataSnapshot,
		modelsYmlTarget,
		modelsJsonTarget,
		change.document,
	);
	return change.document;
}

async function refreshRegistryAfterPersistence(
	ctx: RegistryRefreshContext,
	persist: () => Promise<StateDocument>,
): Promise<StateDocument> {
	let document: StateDocument;
	try {
		document = await withConfigurationLock(persist);
		invalidateStateCache();
	} catch (error) {
		throw new Error(t("models.yml/models.json/state.json 未完整保存：{error}", { error: formatUnknownError(error) }));
	}
	try {
		if (ctx?.modelRegistry && typeof ctx.modelRegistry.refresh === "function") {
			await ctx.modelRegistry.refresh();
		}
	} catch (error) {
		throw new Error(t("models.yml/models.json/state.json 已写入，但当前会话 registry 重载失败：{error}。可执行 /reload 重试。", { error: formatUnknownError(error) }));
	}
	return document;
}

export async function persistManagedConfiguration(
	ctx: RegistryRefreshContext,
	prepare: PrepareConfigurationChange,
): Promise<StateDocument> {
	return refreshRegistryAfterPersistence(ctx, () => persistConfigurationInsideLock(
		prepare,
		(source, change) => buildSynchronizedModelsDocument(
			change.document,
			source,
			change.removedProviderIds,
			change.changedProviderIds,
		),
	));
}

export async function persistProviderRenameConfiguration(
	ctx: RegistryRefreshContext,
	prepare: PrepareConfigurationChange,
	oldProviderId: string,
	newProviderId: string,
): Promise<StateDocument> {
	return refreshRegistryAfterPersistence(ctx, () => persistConfigurationInsideLock(
		prepare,
		(source, change) => buildSynchronizedModelsDocument(
			change.document,
			renameProviderInDoc(source, oldProviderId, newProviderId),
			change.removedProviderIds,
			change.changedProviderIds,
		),
	));
}

export async function persistModelConfiguration(
	ctx: RegistryRefreshContext,
	prepare: PrepareConfigurationChange,
	providerId: string,
	modelId: string,
): Promise<StateDocument> {
	return refreshRegistryAfterPersistence(ctx, () => persistConfigurationInsideLock(
		prepare,
		(source, change) => buildModelsDocumentWithSynchronizedModel(
			change.document,
			source,
			providerId,
			modelId,
		),
	));
}

export async function persistModelRenameConfiguration(
	ctx: RegistryRefreshContext,
	prepare: PrepareConfigurationChange,
	providerId: string,
	oldModelId: string,
	newModelId: string,
): Promise<StateDocument> {
	return refreshRegistryAfterPersistence(ctx, () => persistConfigurationInsideLock(
		prepare,
		(source, change) => buildModelsDocumentWithSynchronizedModel(
			change.document,
			renameModelInDoc(source, providerId, oldModelId, newModelId),
			providerId,
			newModelId,
			oldModelId,
		),
	));
}

export async function persistModelDeletionConfiguration(
	ctx: RegistryRefreshContext,
	prepare: PrepareConfigurationChange,
	providerId: string,
	modelId: string,
): Promise<StateDocument> {
	return refreshRegistryAfterPersistence(ctx, () => persistConfigurationInsideLock(
		prepare,
		(source, change) => buildModelsDocumentWithoutModel(change.document, source, providerId, modelId),
	));
}
