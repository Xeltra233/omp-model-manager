// state-cache.ts
//
// 请求路径上的轻量 StateDocument 缓存。外部改动由文件签名检测，插件自身 mutation 还会主动失效。

import { readFileSignature, sameFileSignature, type FileSignature } from "./file-snapshot.ts";
import { getModelsJsonPath, getModelsYmlPath } from "./models-config-manager.ts";
import { readState, getStatePath } from "./state-store.ts";
import type { StateDocument } from "./types.ts";

interface StateSignature {
	modelsYml: FileSignature;
	modelsJson: FileSignature;
	metadataState: FileSignature;
}

let cachedState: { signature: StateSignature; state: StateDocument } | undefined;

async function readStateSignature(): Promise<StateSignature> {
	const [modelsYml, modelsJson, metadataState] = await Promise.all([
		readFileSignature(getModelsYmlPath()),
		readFileSignature(getModelsJsonPath()),
		readFileSignature(getStatePath()),
	]);
	return { modelsYml, modelsJson, metadataState };
}

function sameStateSignature(a: StateSignature, b: StateSignature): boolean {
	return sameFileSignature(a.modelsYml, b.modelsYml)
		&& sameFileSignature(a.modelsJson, b.modelsJson)
		&& sameFileSignature(a.metadataState, b.metadataState);
}

export function invalidateStateCache(): void {
	cachedState = undefined;
}

export async function readCachedState(): Promise<StateDocument> {
	const signature = await readStateSignature();
	if (cachedState && sameStateSignature(cachedState.signature, signature)) {
		return cachedState.state;
	}

	// StateDocument 横跨配置文件与元数据；只缓存同一稳定读取窗口内得到的组合。
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const before = await readStateSignature();
		const state = await readState();
		const after = await readStateSignature();
		if (sameStateSignature(before, after)) {
			cachedState = { signature: after, state };
			return state;
		}
	}

	return readState();
}
