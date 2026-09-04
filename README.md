# omp-model-manager

[English](./README.en.md) · 简体中文

[![OMP](https://img.shields.io/badge/OMP-%3E%3D18.0.0-6f42c1)](https://github.com/can1357/oh-my-pi)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Upstream](https://img.shields.io/badge/upstream-pi--model--manager-2f81f7.svg)](https://github.com/Qihuanxishini/pi-model-manager)

面向 [OMP (Oh My Pi)](https://github.com/can1357/oh-my-pi) 的终端 TUI 交互式模型与自定义接入点管理器。

> 📌 **项目声明**：本项目是 [pi-model-manager](https://github.com/Qihuanxishini/pi-model-manager)（作者 [@Qihuanxishini](https://github.com/Qihuanxishini)）针对 **OMP (Oh My Pi)** 生态的**移植与适配版**。衷心感谢原作者为社区带来的优秀设计！

---

## 为什么需要 omp-model-manager？

在 OMP (Oh My Pi) 原生设计中，添加和维护第三方大模型或中转服务商接入点通常只能通过手动编辑 `~/.omp/agent/models.yml` 文件。手动手写 YAML 配置既繁琐又极易出现缩进格式错误、模型 ID 遗漏、协议类型选错等问题。

`omp-model-manager` 将强大的终端交互式面板带入了 OMP：
- 🚀 **交互式 TUI 管理**：在终端中图形化查看、新增、编辑、删除接入点与模型。
- 🔄 **YAML + JSON 双向原子持久化**：优先无缝读写 OMP 主推的 `models.yml` 格式，同时原子同步 `models.json`，确保 OMP 原生命令（如 `omp models`、`/model`、`--models`）开箱即用。
- 🔍 **一键拉取上游模型**：支持在线探测上游 OpenAI、Anthropic、Google 服务并自动获取可用模型 ID 列表。
- 🛡️ **请求头与客户端身份伪装**：内置 Codex CLI / Claude Code 请求头配置与自动推荐，支持中转站身份鉴权。
- 🌐 **接入点级独立代理**：为特定 API 独立开启 HTTP/HTTPS 代理转发，不污染宿主全局网络。
- ⚡ **事务性与高可用性**：内置跨进程文件锁、崩溃自动恢复、失效模型自动救援提示，杜绝半写入配置损坏。

---

## 界面预览

```text
────────────────────────────────────────────────────────────────────────────────────────
/omp-model-manager
4 接入 · 5 模型 · 0 内置抓包 · 0 自定义请求头

  接入                API          模型  请求头           代理    认证    状态
❯ OpenAI (openai)     Responses       2  Auto→Codex       direct  env     ready
  Claude (claude)     Claude          1  ClaudeCode       direct  env     ready
  Gemini (gemini)     Gemini          1  Auto→不添加      direct  env     ready
  Local vLLM (local)  Chat            1  Off              proxy   key     ready

────────────────────────────────────────────────────────────────────────────────────────
OpenAI (openai)
  endpoint  https://api.openai.com/v1
  proxy     direct
  api       Responses · headers Auto→Codex · auth env
  models    gpt-5.6-sol, gpt-5.6-terra

↑↓ 选择   Enter 进入   N 新建接入   D 删除接入   H 请求头   L 切换语言   Esc 退出   / 搜索
────────────────────────────────────────────────────────────────────────────────────────
```

---

## 安装与使用

### 安装方式

#### 方式一：OMP 指令一键安装（推荐）

在终端中直接执行：
```bash
omp install github:Xeltra233/omp-model-manager
```
或使用 plugin 命令：
```bash
omp plugin install github:Xeltra233/omp-model-manager
```

#### 方式二：克隆到扩展目录本地加载
```bash
git clone https://github.com/Xeltra233/omp-model-manager.git ~/.omp/agent/extensions/omp-model-manager
```

### 启动命令

在 OMP 对话交互模式下，输入以下任意命令即可打开管理面板：
- `/omp-model-manager`（主命令）
- `/model-manager`（兼容别名）
- `/omm`（快捷别名）

---

## 核心功能特性

### 1. OMP 双配置持久化规范 (`models.yml` + `models.json`)
- **权威来源**：在 OMP 中，模型配置的权威存储位于 `~/.omp/agent/models.yml`。
- **自动双写**：任何在 TUI 中的创建、修改、重命名或删除，均会在事务锁保护下原子更新 `models.yml` 与 `models.json`。
- **即时刷新**：保存后立即同步当前 OMP 会话模型目录，无需频繁重启客户端。

### 2. 交互式接入与模型编辑
- 支持配置 API 协议类型：
  - `openai-responses` (OpenAI Responses 规范)
  - `openai-completions` (OpenAI Chat Completions 规范)
  - `anthropic-messages` (Anthropic Messages 规范)
  - `google-generative-ai` (Google Gemini 规范)
- 自动探测：连接测试上游 API 并拉取全部可用模型 ID，无需手工核对。
- 细粒度参数：独立调整输入多模态支持（文本/视觉）、Reasoning/Thinking 协议开关、上下文窗口大小、最大 token 数。

### 3. 完整思考深度与协议自适应（Thinking Levels）
- **完整 7 档深度支持**：支持 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` 完整等级梯队，默认全部开放可用，不再因模型名模式或内置规则在界面中隐式裁剪。
- **协议映射与直通**：全量等级（minimal, low, medium, high, xhigh, max）完全原样直通至模型与上游端点，不做任何静默降级或拦截。
- **自定义映射（`thinkingLevelMap`）**：支持在模型中自定义特定等级发给上游的真实参数字符串，例如：
  ```yaml
  thinkingLevelMap:
    max: "high"
  ```
- **平滑兼容升级**：自动迁移旧版本自动生成的限制性配置（如历史遗留的 `minimal: null` 或 `xhigh/max: null`），无缝升级为全部开放。

### 4. 请求头 Profile 与客户端身份模拟
- 内置针对中转或特定网关所需的客户端请求头模板（如 Codex CLI、Claude Code 等）。
- 支持用户自定义持久化请求头 Profile，并在接入点间灵活复用。

### 5. 接入点本地代理转发
- 支持为特定接入点单独配置 HTTP/HTTPS 代理（如 `http://127.0.0.1:7890`）。
- 插件仅在本地动态建立轻量级代理路由，对非代理接入点零性能损耗。

---

## 配置文件路径

| 文件 | 作用 |
| --- | --- |
| `~/.omp/agent/models.yml` | OMP 首要原生模型配置文件（YAML 格式，人类可读） |
| `~/.omp/agent/models.json` | OMP 兼容器配置备份（JSON 格式） |
| `~/.omp/agent/extensions/omp-model-manager/state.json` | 插件元数据（请求头 Profile、抓包捕获、代理状态等） |
| `~/.omp/agent/settings.json` | OMP 用户偏好与 `enabledModels` 模型白名单 |

---

## 开发与测试

本项目采用 Node.js / Bun 双兼容测试体系：

```bash
# 运行完整单元与回归测试套件（64 项测试）
npm test
# 或使用 Bun
bun test
```

---

## 致谢与许可 (Credits & License)

- 本项目基于 [pi-model-manager](https://github.com/Qihuanxishini/pi-model-manager) 进行深度移植与 OMP 适配，原作者为 [Qihuanxishini](https://github.com/Qihuanxishini)。
- 本项目继承使用 **GNU Affero General Public License v3.0 (AGPL-3.0)** 开源。详见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)。
