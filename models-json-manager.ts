// models-json-manager.ts
//
// 兼容性转发模块：将历史 models.json 调用平滑桥接到 models-config-manager.ts

export * from "./models-config-manager.ts";
export {
	readModelsConfigSnapshot as readModelsJsonSnapshot,
	type ModelsConfigDocument as ModelsJsonDocument,
	type ModelsConfigModelEntry as ModelsJsonModelEntry,
	type ModelsConfigProviderEntry as ModelsJsonProviderEntry,
	type ModelsConfigSnapshot as ModelsJsonSnapshot,
} from "./models-config-manager.ts";
