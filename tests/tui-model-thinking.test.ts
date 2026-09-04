import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { setUiLanguage, t } from "../i18n.ts";
import {
	formatModelListHeader,
	formatModelListRow,
	getModelColumnWidths,
} from "../tui/ui-helpers.ts";
import type { ModelDraft, StoredModel, StoredProvider } from "../types.ts";

const enabledModel: StoredModel = {
	id: "thinking-model-pro",
	name: "Thinking Model Pro",
	reasoning: true,
	input: ["text", "image"],
	contextWindow: 128_000,
	maxTokens: 16_384,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const disabledModel: StoredModel = {
	id: "standard-model",
	name: "Standard Model",
	reasoning: false,
	input: ["text"],
	contextWindow: 64_000,
	maxTokens: 4_096,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const provider: StoredProvider = {
	name: "Thinking Provider",
	api: "openai-responses",
	baseUrl: "https://example.test/v1",
	managed: true,
	clientHeaderProfile: "recommended",
	models: [enabledModel, disabledModel],
};

test("TUI 表格在 60/80/100 终端宽度下展示 Thinking 列且无溢出", () => {
	setUiLanguage("zh-CN");
	for (const width of [60, 80, 100]) {
		const rowWidth = width - 2;
		const widths = getModelColumnWidths([enabledModel, disabledModel]);
		const header = formatModelListHeader(provider, width, widths);
		const rowEnabled = formatModelListRow(provider, enabledModel, rowWidth, widths);
		const rowDisabled = formatModelListRow(provider, disabledModel, rowWidth, widths);

		assert.ok(visibleWidth(header) <= width, `${width} 宽 Header 溢出`);
		assert.ok(visibleWidth(rowEnabled) <= rowWidth, `${width} 宽启用行溢出`);
		assert.ok(visibleWidth(rowDisabled) <= rowWidth, `${width} 宽禁用行溢出`);

		assert.match(header, /Thinking/);
		assert.match(rowEnabled, /开/);
		assert.match(rowDisabled, /关/);
	}
});

test("英文语言下 TUI 表格正确格式化 Thinking 列", () => {
	setUiLanguage("en");
	for (const width of [60, 80, 100]) {
		const rowWidth = width - 2;
		const widths = getModelColumnWidths([enabledModel, disabledModel]);
		const header = formatModelListHeader(provider, width, widths);
		const rowEnabled = formatModelListRow(provider, enabledModel, rowWidth, widths);
		const rowDisabled = formatModelListRow(provider, disabledModel, rowWidth, widths);

		assert.ok(visibleWidth(header) <= width, `${width} 宽英文 Header 溢出`);
		assert.ok(visibleWidth(rowEnabled) <= rowWidth, `${width} 宽英文启用行溢出`);
		assert.ok(visibleWidth(rowDisabled) <= rowWidth, `${width} 宽英文禁用行溢出`);

		assert.match(header, /Thinking/);
		assert.match(rowEnabled, /On/);
		assert.match(rowDisabled, /Off/);
	}
	setUiLanguage("zh-CN");
});
