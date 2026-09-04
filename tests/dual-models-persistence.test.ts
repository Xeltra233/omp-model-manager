import assert from "node:assert/strict";
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import YAML from "yaml";

process.env.PI_CODING_AGENT_DIR = join(process.cwd(), ".tmp-dual-test", `agent-${process.pid}`);
process.env.OMP_CODING_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;

const { getAgentDir } = await import("./pi-coding-agent-stub.ts");
const agentDir = getAgentDir();
const MODELS_YML_PATH = join(agentDir, "models.yml");
const MODELS_JSON_PATH = join(agentDir, "models.json");
const STATE_DIR = join(agentDir, "extensions", "omp-model-manager");

const { readModelsConfigSnapshot, parseModelsConfig } = await import("../models-config-manager.ts");
const { persistManagedConfiguration } = await import("../configuration-persistence.ts");
const { readState } = await import("../state-store.ts");

beforeEach(async () => {
	await rm(agentDir, { recursive: true, force: true });
	await mkdir(STATE_DIR, { recursive: true });
});

after(async () => {
	await rm(agentDir, { recursive: true, force: true });
});

test("models.yml 与 models.json 双文件在模型变动时双向原子持久化同步", async () => {
	const initialYml = `providers:
  custom-provider:
    name: Custom Provider
    api: openai-completions
    baseUrl: https://api.custom.com/v1
    models:
      - id: custom-model-1
        name: Custom Model 1
`;
	await writeFile(MODELS_YML_PATH, initialYml, "utf8");

	const snapshot = await readModelsConfigSnapshot();
	assert.equal(snapshot.format, "yaml");
	assert.ok(snapshot.document.providers["custom-provider"]);

	const state = await readState();
	assert.ok(state.providers["custom-provider"]);
	assert.equal(state.providers["custom-provider"].name, "Custom Provider");
	assert.equal(state.providers["custom-provider"].models[0].id, "custom-model-1");

	const ctx = {
		modelRegistry: { refresh: async () => undefined },
	} as any;

	// 新增一个模型到该 provider
	await persistManagedConfiguration(ctx, (latest) => {
		const document = structuredClone(latest);
		document.providers["custom-provider"].models.push({
			id: "custom-model-2",
			name: "Custom Model 2",
			api: "openai-completions",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		});
		return {
			document,
			changedProviderIds: ["custom-provider"],
			removedProviderIds: [],
		};
	});

	// 检查 models.yml 是否同步更新且符合 YAML 语法
	const updatedYmlRaw = await readFile(MODELS_YML_PATH, "utf8");
	const parsedYml = YAML.parse(updatedYmlRaw);
	assert.equal(parsedYml.providers["custom-provider"].models.length, 2);
	assert.equal(parsedYml.providers["custom-provider"].models[1].id, "custom-model-2");

	// 检查 models.json 是否也同步生成并保持一致
	const updatedJsonRaw = await readFile(MODELS_JSON_PATH, "utf8");
	const parsedJson = JSON.parse(updatedJsonRaw);
	assert.equal(parsedJson.providers["custom-provider"].models.length, 2);
	assert.equal(parsedJson.providers["custom-provider"].models[1].id, "custom-model-2");

	// 再次通过 readState 读取，确保双文件解析一致
	const nextState = await readState();
	assert.equal(nextState.providers["custom-provider"].models.length, 2);
	assert.equal(nextState.providers["custom-provider"].models[1].id, "custom-model-2");
});
