// YAML 工具类：支持 models.yml 文件的解析与格式化序列化。

import * as YAML from "yaml";

const YAML_MAPPING_HEADER_TRAILING_SPACE = /: +$/gm;

export function parseYaml(source: string): unknown {
	return YAML.parse(source);
}

export function stringifyYaml(value: unknown): string {
	const text = YAML.stringify(value, {
		indent: 2,
		lineWidth: 0,
		singleQuote: false,
	});
	return text.replace(YAML_MAPPING_HEADER_TRAILING_SPACE, ":");
}
