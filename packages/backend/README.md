# Backend

Express + TypeScript 后端服务，仅做 AI / TTS 代理，不做用户系统。

## 启动

```bash
# 1. 复制环境变量模板
cp .env.example .env
# 编辑 .env 填入 DEEPSEEK_API_KEY 和 MIMO_API_KEY

# 2. 启动开发服务（热重载）
pnpm dev
```

服务默认监听 `http://localhost:4000`。

## 当前已实现端点（Phase A）

- `GET /api/health` — 健康检查
- `GET /api/voices` — 音色列表（仅返回预置条目，Phase C 接入实际 API）
- `POST /api/split-script` — AI 智能分段（Phase B 接入 DeepSeek）
- `POST /api/tts` — TTS 合成（Phase C 接入 MiMo + edge-tts）

## 项目结构

```
src/
├── server.ts           # 入口（express 启动）
├── app.ts              # express app 配置（中间件、路由注册）
├── config/
│   └── env.ts          # 环境变量校验
├── routes/
│   ├── health.ts
│   ├── voices.ts
│   ├── split-script.ts
│   └── tts.ts
└── types/              # 内部类型（与 shared-types 区分）
```
