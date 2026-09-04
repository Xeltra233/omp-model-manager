import assert from "node:assert/strict";
import { test } from "node:test";
import { setUiLanguage, t } from "../i18n.ts";
import modelManagerExtension from "../index.ts";

test("命令注册描述与国际化在任何语言下均不出现中英文双显示斜杠", async () => {
	const registeredCommands: Record<string, { description?: string }> = {};
	const fakePi = {
		registerCommand(name: string, options: { description?: string; handler: unknown }) {
			registeredCommands[name] = options;
		},
		on() {},
	} as any;

	// 1. 中文模式测试
	setUiLanguage("zh-CN");
	await modelManagerExtension(fakePi);

	assert.ok(registeredCommands["model-manager"]);
	assert.ok(registeredCommands["omp-model-manager"]);
	assert.ok(registeredCommands["omm"]);

	const zhDesc = registeredCommands["model-manager"].description;
	assert.ok(zhDesc, "必须有命令描述");
	assert.equal(zhDesc.includes(" / "), false, `中文描述不应包含中英双显示斜杠：${zhDesc}`);
	assert.match(zhDesc, /模型接入与请求配置/);
	assert.doesNotMatch(zhDesc, /Model and provider settings/);

	// 2. 英文模式测试
	const { writeUiLanguage } = await import("../ui-language-settings.ts");
	await writeUiLanguage("en");
	const enRegisteredCommands: Record<string, { description?: string }> = {};
	const enFakePi = {
		registerCommand(name: string, options: { description?: string; handler: unknown }) {
			enRegisteredCommands[name] = options;
		},
		on() {},
	} as any;

	await modelManagerExtension(enFakePi);
	const enDesc = enRegisteredCommands["model-manager"].description;
	assert.ok(enDesc, "必须有英文命令描述");
	assert.equal(enDesc.includes(" / "), false, `英文描述不应包含中英双显示斜杠：${enDesc}`);
	assert.match(enDesc, /Model and provider settings/);
	assert.doesNotMatch(enDesc, /模型接入与请求配置/);

	// 恢复默认语言
	await writeUiLanguage("zh-CN");
	setUiLanguage("zh-CN");
});
