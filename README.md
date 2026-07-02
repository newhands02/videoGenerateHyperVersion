# WebFrames

> 仿照 [HyperFrames](../README) 核心逻辑的纯前端视频脚本编排工具

## 项目定位

**WebFrames** 是一个"用编排网页的方式做视频"的工具：

- 粘贴文章 → AI 智能分段（DeepSeek V4 Pro）→ TTS 试听（小米 MiMo v2.5 / edge-tts）→ 配场景模板 → 拖时间轴 → 浏览器实时预览 → 导出标准 HyperFrames 项目包 → 本地 `bash render.sh` 出 MP4

**与 HyperFrames 的关系**：WebFrames 是 HyperFrames 的"前置编排器"。HyperFrames 负责把 HTML+JSON+音频渲染成 MP4，WebFrames 负责生成 HyperFrames 能直接吃的项目包。

## 当前阶段

🚧 **v0.1.3 设计定稿 / Phase A 脚手架 ✅ 完成 / Phase B 编辑器开发中**

完整设计文档见：[`docs/PROJECT_DESIGN.md`](docs/PROJECT_DESIGN.md)

## 已完成（Phase A · 2026-07-02）

- ✅ pnpm 9.15.0 + monorepo（`packages/shared-types` / `backend` / `frontend`）
- ✅ TypeScript 严格模式，3 个包 `typecheck` 全过
- ✅ 后端 Express + dotenv + cors + morgan，4 个 API 端点（health / voices / split-script / tts）
- ✅ 前端 Vue 3 + Vite + Pinia + Vue Router + Naive UI，5 个 store + 4 步路由 + Home 入口
- ✅ Vite 反代 `/api` → `http://localhost:4000`
- ✅ 19 个预置音色（9 MiMo + 10 edge-tts 中文子集）已写入后端
- ✅ 一键 `pnpm dev` 同时启动前后端

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Naive UI |
| 后端 | Node.js + Express + TypeScript（仅做 AI/TTS 代理） |
| 外部服务 | DeepSeek V4 Pro · 小米 MiMo TTS v2.5 · edge-tts（备选） |
| 存储 | IndexedDB（项目 + 音色库 + 复刻样本） |
| 仓库结构 | pnpm workspace monorepo |

## 路线图

- **Phase A**（1 周）：monorepo 脚手架 + 数据模型 + 4 步路由
- **Phase B**（1 周）：编辑器核心 + 三模式分段（手动/AI/AI+人工协同）
- **Phase C**（1.5 周）：TTS 双引擎试听 + 音色库管理
- **Phase D**（0.5 周）：导出 .zip + 端到端联调

## 快速开始（Phase A 完成之后）

```bash
# 1. 克隆
git clone https://github.com/newhands02/videoGenerateHyperVersion.git
cd videoGenerateHyperVersion

# 2. 安装依赖（需 pnpm）
pnpm install

# 3. 配置后端凭据
cp packages/backend/.env.example packages/backend/.env
# 编辑 .env 填入 DEEPSEEK_API_KEY 和 MIMO_API_KEY

# 4. 启动开发环境（前端 + 后端并发）
pnpm dev

# 5. 打开浏览器访问 http://localhost:5173
```

## 目录结构

```
.
├── docs/                          # 项目设计文档
│   └── PROJECT_DESIGN.md          # v0.1.3 设计定稿（1741 行）
├── packages/
│   ├── shared-types/              # 前后端共享 TypeScript 类型
│   │   └── src/index.ts           # Project / Segment / VoiceEntry / TtsRequest 等
│   ├── backend/                   # Express 后端
│   │   ├── src/
│   │   │   ├── server.ts          # 入口
│   │   │   ├── app.ts             # express 配置
│   │   │   ├── config/env.ts      # 环境变量
│   │   │   └── routes/            # 4 个 API 端点
│   │   └── .env.example           # 凭据模板
│   └── frontend/                  # Vue 3 前端
│       ├── src/
│       │   ├── main.ts / App.vue
│       │   ├── router/            # 4 步路由
│       │   ├── stores/            # 5 个 Pinia store
│       │   ├── views/             # Home + 4 个 Step
│       │   ├── api/               # 后端 API 客户端
│       │   └── styles/global.css
│       ├── index.html
│       └── vite.config.ts
├── .gitignore
├── .npmrc                         # pnpm 隔离配置
├── package.json                   # 根 scripts: dev / build / typecheck
├── pnpm-workspace.yaml
└── README.md
```

## 许可

MIT
