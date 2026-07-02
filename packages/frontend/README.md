# Frontend

Vue 3 + Vite + TypeScript 前端，4 步编排流程：
1. **输入** — 粘贴文章
2. **分段** — 手动 / AI / AI+人工协同
3. **配场景** — 选模板 + 改参数
4. **时间轴** — 拖拽 + 试听

## 启动

```bash
# 在项目根目录运行（推荐）
pnpm dev:frontend

# 或在此目录运行
pnpm dev
```

浏览器打开 http://localhost:5173

Vite 已经把 `/api/*` 反代到后端 `http://localhost:4000`。

## 目录结构

```
src/
├── main.ts               # 入口
├── App.vue
├── router/               # 4 步路由
├── stores/               # Pinia 5 个 store
├── views/                # 4 个步骤页
├── components/           # 通用组件 + 业务组件
├── api/                  # 后端 API 客户端
└── styles/               # 全局样式
```

## Phase 状态

- ✅ Phase A：脚手架 + 4 步空页面 + API 客户端
- ⏳ Phase B：编辑器核心（手动分段 + 拖拽）
- ⏳ Phase C：TTS 试听 + 音色库
- ⏳ Phase D：导出
