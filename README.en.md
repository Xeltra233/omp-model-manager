# omp-model-manager

English · [简体中文](./README.md)

[![OMP](https://img.shields.io/badge/OMP-%3E%3D18.0.0-6f42c1)](https://github.com/oh-my-pi)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Upstream](https://img.shields.io/badge/upstream-pi--model--manager-2f81f7.svg)](https://github.com/Qihuanxishini/pi-model-manager)

An interactive TUI model and custom provider manager for [OMP (Oh My Pi)](https://github.com/oh-my-pi).

> 📌 **Project Notice**: This project is a port and adaptation of [pi-model-manager](https://github.com/Qihuanxishini/pi-model-manager) (authored by [@Qihuanxishini](https://github.com/Qihuanxishini)) for the **OMP (Oh My Pi)** ecosystem. Huge thanks to the original author for the excellent design!

---

## Why omp-model-manager?

In OMP (Oh My Pi), adding and maintaining custom model providers normally requires manually editing the YAML file `~/.omp/agent/models.yml`. Hand-writing YAML configuration is cumbersome, error-prone (indentation, typos, missing IDs, mismatched protocols), and lacks real-time validation.

`omp-model-manager` introduces an interactive terminal TUI dashboard to OMP:
- 🚀 **Interactive TUI Management**: Graphically browse, add, edit, and delete providers and models within your terminal.
- 🔄 **YAML + JSON Dual Atomic Persistence**: Reads and writes OMP's primary `models.yml` format while synchronizing `models.json` atomically. Native OMP commands (`omp models`, `/model`, `--models`) work seamlessly out-of-the-box.
- 🔍 **Upstream Model Discovery**: Query upstream OpenAI, Anthropic, or Google endpoints to fetch available model IDs with one click.
- 🛡️ **Request Headers & Client Impersonation**: Built-in header profiles for Codex CLI and Claude Code, with support for custom profiles.
- 🌐 **Per-Provider Local Proxy**: Route specific providers through custom HTTP/HTTPS proxies without modifying system-wide environment variables.
- ⚡ **Transactional Resilience**: Multi-file transaction locks, automatic crash recovery, and model rescue on deletion or rename.

---

## Preview

```text
────────────────────────────────────────────────────────────────────────────────────────
/omp-model-manager
4 providers · 5 models · 0 captures · 0 custom header profiles

  Provider            API          Models  Headers          Proxy   Auth    Status
❯ OpenAI (openai)     Responses         2  Auto→Codex       direct  env     ready
  Claude (claude)     Claude            1  ClaudeCode       direct  env     ready
  Gemini (gemini)     Gemini            1  Auto→None        direct  env     ready
  Local vLLM (local)  Chat              1  Off              proxy   key     ready

────────────────────────────────────────────────────────────────────────────────────────
OpenAI (openai)
  endpoint  https://api.openai.com/v1
  proxy     direct
  api       Responses · headers Auto→Codex · auth env
  models    gpt-5.6-sol, gpt-5.6-terra

↑↓ Select   Enter Open   N New Provider   D Delete   H Headers   L Language   Esc Exit   / Search
────────────────────────────────────────────────────────────────────────────────────────
```

---

## Installation & Usage

### Installation

#### Option 1: Via OMP Package Manager
```bash
omp install github:Xeltra233/omp-model-manager
```

#### Option 2: Clone to Local Extensions Directory
```bash
git clone https://github.com/Xeltra233/omp-model-manager.git ~/.omp/agent/extensions/omp-model-manager
```

### Launch Commands

In OMP interactive mode, use any of the following slash commands:
- `/omp-model-manager` (Primary command)
- `/model-manager` (Compatibility alias)
- `/omm` (Short alias)

---

## Key Features

### 1. OMP Dual Persistence Specification (`models.yml` + `models.json`)
- **Authoritative Source**: In OMP, models are stored primarily in `~/.omp/agent/models.yml`.
- **Atomic Synchronization**: Any changes made via the TUI are transactionally written to both `models.yml` and `models.json`.
- **Live Refresh**: Immediately registers updated catalog entries into the active OMP session without requiring a restart.

### 2. Provider & Model Editing
- Supported protocols:
  - `openai-responses` (OpenAI Responses)
  - `openai-completions` (OpenAI Chat Completions)
  - `anthropic-messages` (Anthropic Messages)
  - `google-generative-ai` (Google Gemini)
- Probe & Pick: Test connection and retrieve remote model IDs directly from the form.
- Fine-grained controls: Multimodal capabilities (vision), reasoning/thinking modes, context window sizes, token limits.

### 3. Request Header Profiles
- Pre-configured headers for tools like Codex CLI and Claude Code.
- Create, manage, and assign reusable custom header profiles across multiple providers.

### 4. Per-Provider Proxy Routing
- Configure dedicated HTTP/HTTPS proxy URLs (e.g. `http://127.0.0.1:7890`) per provider.
- Lightweight local proxy daemon with on-demand routing.

---

## Configuration Paths

| File | Description |
| --- | --- |
| `~/.omp/agent/models.yml` | Primary native OMP models configuration (YAML) |
| `~/.omp/agent/models.json` | Fallback / compatibility OMP models configuration (JSON) |
| `~/.omp/agent/extensions/omp-model-manager/state.json` | Extension metadata (header profiles, captures, proxy routes) |
| `~/.omp/agent/settings.json` | User preferences and `enabledModels` filter |

---

## Testing

Comprehensive test suite (64 unit and regression tests) supporting Node.js and Bun:

```bash
# Run with Node.js
npm test

# Or run with Bun
bun test
```

---

## Credits & License

- Adapted and ported from [pi-model-manager](https://github.com/Qihuanxishini/pi-model-manager) by [Qihuanxishini](https://github.com/Qihuanxishini).
- Licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE) for details.
