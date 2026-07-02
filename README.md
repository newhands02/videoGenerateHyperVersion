# WebFrames

> 仿照 [HyperFrames](../README) 核心逻辑的纯前端视频脚本编排工具

## 项目定位

**WebFrames** 是一个"用编排网页的方式做视频"的工具：

- 粘贴文章 → AI 智能分段（DeepSeek V4 Pro）→ TTS 试听（小米 MiMo v2.5 / edge-tts）→ 配场景模板 → 拖时间轴 → 浏览器实时预览 → 导出标准 HyperFrames 项目包 → 本地 `bash render.sh` 出 MP4

**与 HyperFrames 的关系**：WebFrames 是 HyperFrames 的"前置编排器"。HyperFrames 负责把 HTML+JSON+音频渲染成 MP4，WebFrames 负责生成 HyperFrames 能直接吃的项目包。

## 当前阶段

🚧 **v0.1.3 设计定稿 / Phase A 脚手架开发中**

完整设计文档见：[`docs/PROJECT_DESIGN.md`](docs/PROJECT_DESIGN.md)

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

## 目录结构（计划）

```
.
├── docs/                     # 项目设计文档
│   └── PROJECT_DESIGN.md     # v0.1.3 设计定稿
├── packages/
│   ├── frontend/             # Vue 3 前端（Phase A 创建）
│   └── backend/              # Express 后端（Phase A 创建）
├── .gitignore
└── README.md
```

## 许可

MIT
