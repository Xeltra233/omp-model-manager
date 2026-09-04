// OMP 配置值允许字面量、!command，以及 $NAME/${NAME} 环境变量模板。

import { execSync } from "node:child_process";

const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_VAR_NAME_PREFIX_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*/;

export function isCommandConfigValue(config: string): boolean {
	return config.startsWith("!");
}

export function getConfigValueEnvVarNames(config: string): string[] {
	if (isCommandConfigValue(config)) return [];
	const names: string[] = [];
	let index = 0;
	while (index < config.length) {
		const dollarIndex = config.indexOf("$", index);
		if (dollarIndex < 0) break;
		const nextCharacter = config[dollarIndex + 1];
		if (nextCharacter === "$" || nextCharacter === "!") {
			index = dollarIndex + 2;
			continue;
		}
		if (nextCharacter === "{") {
			const endIndex = config.indexOf("}", dollarIndex + 2);
			if (endIndex < 0) {
				index = dollarIndex + 1;
				continue;
			}
			const name = config.slice(dollarIndex + 2, endIndex);
			if (ENV_VAR_NAME_PATTERN.test(name) && !names.includes(name)) names.push(name);
			index = endIndex + 1;
			continue;
		}
		const match = config.slice(dollarIndex + 1).match(ENV_VAR_NAME_PREFIX_PATTERN);
		if (match) {
			if (!names.includes(match[0])) names.push(match[0]);
			index = dollarIndex + 1 + match[0].length;
			continue;
		}
		index = dollarIndex + 1;
	}
	return names;
}

export function getSingleConfigValueEnvVarName(config: string): string | undefined {
	const bracedMatch = config.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
	if (bracedMatch) return bracedMatch[1];
	const unbracedMatch = config.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
	return unbracedMatch?.[1];
}

/** 展开配置值（用于模型拉取探测等只读场景） */
export function resolveConfigValue(config: string): string {
	const trimmed = config.trim();
	if (trimmed.startsWith("!")) {
		const cmd = trimmed.slice(1).trim();
		try {
			return execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim();
		} catch {
			return "";
		}
	}
	const singleVar = getSingleConfigValueEnvVarName(trimmed);
	if (singleVar) {
		return process.env[singleVar] ?? "";
	}
	// 支持内嵌变量替换
	const names = getConfigValueEnvVarNames(trimmed);
	if (names.length === 0) return trimmed;
	let result = trimmed;
	for (const name of names) {
		const val = process.env[name] ?? "";
		result = result.replace(new RegExp(`\\$\\{${name}\\}`, "g"), val);
		result = result.replace(new RegExp(`\\$${name}\\b`, "g"), val);
	}
	return result;
}
