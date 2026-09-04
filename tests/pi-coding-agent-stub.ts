import { tmpdir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR_NAME = ".omp";

export function getAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? process.env.OMP_CODING_AGENT_DIR ?? join(tmpdir(), `omp-model-manager-stub-${process.pid}`);
}

export class ModelRuntime {
	static async create(): Promise<{ getModels(): never[] }> {
		return { getModels: () => [] };
	}
}

export class ModelRegistry {
	constructor(_runtime?: unknown) {}
	find(_provider: string, _modelId: string) {
		return { provider: _provider, id: _modelId };
	}
	hasConfiguredAuth(_model: unknown) {
		return true;
	}
	async getApiKeyAndHeaders(_model: unknown) {
		return { ok: true, auth: { apiKey: "test-key", headers: {} } };
	}
	async refresh() {}
	getAll() {
		return [];
	}
	getAvailable() {
		return [];
	}
}

export class BorderedLoader {}

export class SettingsManager {
	static create(): never {
		throw new Error("当前测试不应访问 SettingsManager");
	}
}
