# WebFrames 设计文档

> 仿照 HyperFrames 核心逻辑的 Web 端视频脚本编排工具
>
> 版本：v0.1.3 · 2026-07-02（v0.1++ + AI 提议+人工协同分段 + 复刻样本全局共享 + edge-tts 10 中文子集 + 数值化滑块）

---

## 1. 项目定位

### 1.1 一句话定义

**WebFrames** 是一个纯前端的"类视频"项目编排工具：把一篇文章拆分成时间轴对齐的脚本段，绑定场景、字幕与动画，在浏览器里实时预览，最终导出一个标准的 HyperFrames 项目包（`index.html` + `hyperframes.json` + `script.txt`），由用户在本地用 `bash render.sh` 渲染出 MP4。

### 1.2 解决什么问题

| 痛点 | 现状 | WebFrames 的解法 |
|------|------|------------------|
| 视频脚本分段全靠脑补 | 用 PR/AE 边做边调 | 可视化时间轴，所见即所得 |
| 字幕错位反复调 | TTS 估算时长 + 手工对帧 | 精确计时 + 时间轴拖拽 |
| 改文案要重新剪视频 | PR 工程文件难维护 | 改 JSON 重新跑渲染命令 |
| HyperFrames CLI 学习成本 | 要懂 HTML/GSAP/Node | GUI 编排，零代码出项目包 |

### 1.3 核心边界

- ❌ **不渲染 MP4**——浏览器沙箱拿不到系统级 Chrome 权限，渲染仍走 `npx hyperframes render`
- ❌ **不提供浏览器端 TTS 服务**——TTS 由 **WebFrames 后端代理**统一调用小米 MiMo TTS v2.5（详见 1.4），避免在前端暴露 API Key
- ❌ **不做账号系统 / 云端保存**——项目以 JSON 形式保存在浏览器 IndexedDB，用户可下载/上传
- ✅ **做 AI 文案分段**——v0.1 通过 WebFrames 后端代理调用 DeepSeek V4 Pro（详见 1.4）

### 1.4 外部服务依赖（v0.1 新增）

| 服务 | 用途 | 凭据存储 | 调用入口 |
|------|------|----------|----------|
| **DeepSeek V4 Pro** | AI 文案分段（按叙事节奏切分、生成段落元数据） | WebFrames 后端 `.env`（`DEEPSEEK_API_KEY`） | 后端 `/api/split-script` |
| **小米 MiMo TTS v2.5** | 浏览器内 TTS 试听 + 导出项目包时打包 `tts.py` 调用 | WebFrames 后端 `.env`（`MIMO_API_KEY`） | 后端 `/api/tts` + 导出 `tts.py` |

**关键设计决策**：

1. **前端不直接调用任何 AI/TTS API**——所有凭据在 WebFrames 后端 `.env` 统一管理，避免 Key 泄露
2. **导出项目包内的 `tts.py` 默认用小米 MiMo**——用户本地跑 `bash render.sh` 时，需要在本地 `.env` 填入自己的 `MIMO_API_KEY`
3. **v0.1 后端是 Node.js Express**——只做 AI/TTS 代理，不做用户系统、不做云存储
4. **DeepSeek 用于"智能分段"和"智能建议"**——具体 prompt 见模块 A

### 1.5 重新定义"前端"与"后端"

为清晰起见，本文档后续约定：

- **WebFrames Frontend** = Vue 3 单页应用（用户看到的东西）
- **WebFrames Backend** = Node.js Express 服务（AI/TTS 代理，纯本地或局域网部署，不上公网）
- **导出项目包** = 用户从 WebFrames 下载的 .zip（包含 `index.html` + `tts.py` 等），与 WebFrames 本身完全独立

```
┌──────────────────────────────────────────────────────────────┐
│ 用户浏览器                                                    │
│  ┌────────────────────────────────────────┐  fetch            │
│  │  WebFrames Frontend (Vue 3 SPA)        │ ──────────────┐   │
│  └────────────────────────────────────────┘               │   │
└──────────────────────────────────────────────────────────────┘
                                                              ↓
┌──────────────────────────────────────────────────────────────┐
│ WebFrames Backend (Node.js Express, 本地跑)                  │
│  POST /api/split-script   → DeepSeek V4 Pro                 │
│  POST /api/tts            → 小米 MiMo TTS v2.5              │
│  GET  /api/voices         → 音色列表                          │
│  GET  /api/health         → 健康检查                          │
└──────────────────────────────────────────────────────────────┘
                ↓                              ↓
       api.deepseek.com              api.xiaomimimo.com
```

---

## 2. 核心架构

### 2.1 总体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     WebFrames (浏览器)                       │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐ │
│  │ 文案输入  │ → │ 脚本分段  │ → │ 时间轴   │ → │ 场景编排  │ │
│  │  (粘贴)  │   │  (手动)   │   │  (拖拽)  │   │  (CSS)   │ │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘ │
│       ↓              ↓              ↓              ↓        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Zustand Store (全局状态)                 │  │
│  │   project / script / timeline / scenes / theme       │  │
│  └──────────────────────────────────────────────────────┘  │
│       ↓                                       ↓            │
│  ┌──────────────┐                    ┌──────────────────┐  │
│  │ 实时预览面板  │                    │  项目导出器      │  │
│  │  (iframe)    │                    │  (生成 HF 包)    │  │
│  └──────────────┘                    └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                ↓
                        下载 .zip 项目包
                                ↓
                用户本地：bash render.sh → MP4
```

### 2.2 数据流

```
用户输入文案
  ↓
脚本分段 (ScriptSegment[])
  ↓
为每段配场景 (SceneConfig[])
  ↓
时间轴对齐 (Timeline = [{ segmentId, sceneId, start, end }])
  ↓
预览面板 iframe 加载生成的 index.html
  ↓
导出器打包为标准 HyperFrames 项目
```

### 2.3 技术栈

**前端（WebFrames Frontend）**

| 维度 | 选型 | 理由 |
|------|------|------|
| 框架 | **Vue 3** + Composition API + `<script setup>` | 用户指定；模板语法对设计师友好 |
| 类型 | **TypeScript** | 时间轴/场景数据结构复杂，强类型必要 |
| 构建 | **Vite 5** | Vue 3 官方推荐，HMR 快 |
| 状态管理 | **Pinia** | Vue 3 官方推荐，比 Vuex 轻 |
| UI 组件 | **Naive UI** | Vue 3 原生，主题定制方便，无样式污染 |
| 拖拽 | **vue-draggable-plus** | 时间轴拖拽、场景排序 |
| 样式 | **CSS Variables + Scoped CSS** | 主题切换方便 |
| 存储 | **IndexedDB** (idb-keyval 封装) | 项目文件大（KB 级 JSON） |
| 打包 | **JSZip** | 导出 .zip 项目包 |
| 预览通信 | **postMessage API** | 父页面 ↔ iframe |

**后端（WebFrames Backend）**

| 维度 | 选型 | 理由 |
|------|------|------|
| 运行时 | **Node.js 20 LTS** | 与前端共用 npm 生态 |
| 框架 | **Express 4** | 最简代理，足够 v0.1 |
| LLM SDK | **openai**（OpenAI 兼容） | DeepSeek V4 Pro 走 OpenAI 协议 |
| TTS SDK | **openai**（OpenAI 兼容） | 小米 MiMo 也走 OpenAI 协议 |
| 配置 | **dotenv** | `.env` 加载凭据 |
| CORS | **cors** | 前端跨域访问后端 |
| 日志 | **pino** | 轻量高性能 |

**仓库结构**：使用 **pnpm workspace**（monorepo）

```
webframes/
├── packages/
│   ├── frontend/        # Vue 3 + Vite
│   └── backend/         # Node.js + Express
├── pnpm-workspace.yaml
└── package.json
```

---

## 3. 核心数据模型

### 3.1 Project（项目根）

```typescript
interface Project {
  id: string;                  // UUID
  name: string;                // "我的第一个视频"
  description?: string;
  createdAt: number;           // Date.now()
  updatedAt: number;
  // 视频规格
  width: 1920;
  height: 1080;
  fps: 30;
  // 关联数据
  script: ScriptSegment[];     // 脚本段落
  scenes: SceneConfig[];       // 视觉场景
  timeline: TimelineEntry[];   // 时间轴对齐
  theme: ThemeConfig;          // 主题
}
```

### 3.2 ScriptSegment（脚本段落）

```typescript
interface ScriptSegment {
  id: string;                  // 段 ID
  index: number;               // 序号
  text: string;                // 口播文案
  // TTS 字段（导出时由 tts.py 填充，前端可估算预览）
  estimatedDuration: number;   // 估算时长 = len(text) / 3.8
  actualDuration?: number;     // 实际时长（用户上传音频后回填）
  audioUrl?: string;           // Blob URL（上传的 wav）
  voiceHint?: string;          // 音色建议：女声/男声/童声
  // 备注
  note?: string;               // 编导备注
}
```

### 3.3 SceneConfig（视觉场景）

```typescript
interface SceneConfig {
  id: string;                  // 场景 ID
  name: string;                // "开场 - 提问"
  // 背景
  background: {
    type: 'color' | 'gradient' | 'image';
    value: string;             // 颜色值 / 渐变 CSS / 图片 URL
  };
  // 文字层（最多 3-5 个）
  textLayers: TextLayer[];
  // 装饰元素
  decorations?: Decoration[];
  // 入场动画
  enterAnimation: AnimationPreset;
  // 持续时长（默认 = 绑定段落时长）
  duration?: number;
}

interface TextLayer {
  id: string;
  content: string;
  position: { x: number; y: number };  // 像素坐标
  style: {
    fontSize: number;
    fontWeight: number;
    color: string;
    textAlign: 'left' | 'center' | 'right';
  };
  animation?: AnimationPreset;
}

interface AnimationPreset {
  type: 'fadeIn' | 'slideUp' | 'slideLeft' | 'scale' | 'typewriter' | 'none';
  duration: number;            // 秒
  delay?: number;              // 秒（相对场景开始）
  ease?: string;               // 'power2.out' / 'back.out' 等 GSAP 缓动
}
```

### 3.4 TimelineEntry（时间轴条目）

```typescript
interface TimelineEntry {
  id: string;
  segmentId: string;           // 关联 ScriptSegment
  sceneId: string;             // 关联 SceneConfig
  // 时间区间（相对视频起点，秒）
  start: number;
  end: number;
  // 转场
  transition?: {
    type: 'fade' | 'slide' | 'cut';
    duration: number;
  };
}
```

### 3.5 ThemeConfig（主题）

```typescript
interface ThemeConfig {
  preset: 'tech-dark' | 'warm-light' | 'fresh' | 'custom';
  // 字幕样式
  subtitle: {
    fontSize: number;
    color: string;
    background: string;
    position: 'bottom' | 'top';
  };
  // 配色方案
  palette: {
    primary: string;
    secondary: string;
    accent: string;
  };
  // 字体
  fontFamily: string;
}
```

---

## 4. 页面与组件结构

### 4.1 页面骨架

```
App
├── TopBar           顶栏：项目名、保存、导出、设置
├── Sidebar          左侧：步骤导航（4 步）
│   ├── 1. 文案输入
│   ├── 2. 脚本分段
│   ├── 3. 场景编排
│   └── 4. 时间轴
├── MainArea         主区：根据当前步骤切换
│   ├── Step1Input
│   ├── Step2Script
│   ├── Step3Scenes
│   └── Step4Timeline
├── PreviewPane      右侧固定：实时预览
│   ├── PreviewFrame (iframe)
│   └── PreviewControls (播放/暂停/重播/时间显示)
└── StatusBar        底栏：总时长、段数、状态提示
```

### 4.2 关键组件清单

| 组件 | 职责 | 关键 Props / State |
|------|------|-------------------|
| `<ScriptEditor>` | 编辑单条文案 | segment, onChange |
| `<TimelineTrack>` | 时间轴轨道 | entries, onDragEnd |
| `<SegmentBlock>` | 时间轴上的可拖拽块 | entry, width, color |
| `<SceneCard>` | 场景预览卡片 | scene, onClick |
| `<SceneEditor>` | 弹窗式场景编辑器 | scene, onSave |
| `<PropertyPanel>` | 选中元素属性面板 | target, onChange |
| `<PreviewFrame>` | iframe 预览 + postMessage 通信 | project |
| `<ProjectExporter>` | 生成 .zip 导出 | project |

### 4.3 步骤流转

```
Step 1 (文案输入)
  ↓ 拆分
Step 2 (脚本分段)
  ↓ 配场景
Step 3 (场景编排)
  ↓ 对齐时间
Step 4 (时间轴)
  ↓ 预览满意
导出 HyperFrames 项目包
```

用户可**自由跳转任意步骤**，不强顺序——左侧导航始终可点。

---

## 5. 核心功能模块

### 5.1 模块 A：文案输入与分段

**Step 1 输入**：
- 大文本框，粘贴文章（支持 Markdown 粘贴，自动转纯文本）
- 实时字数统计
- 预估总时长（`字数 / 3.8 / 60` 分钟）

**Step 2 分段**：提供三种模式，用户可自由组合：

#### 模式 1：手动分段（基础、零依赖）

适用场景：用户已经想好怎么分段；或 DeepSeek API 没配；或对分段结果不满意想自己改。

- 按回车分段，每段可拖拽重排
- 每段预估时长实时计算（`len(text) / 3.8`）
- 段属性：音色建议、备注、预估时长
- 操作：合并段、拆分段、删除段、上移下移
- 在段与段之间点 "+" 可插入空段
- 段内点回车可拆分成两段

#### 模式 2：AI 智能分段（v0.1 新增）

适用场景：用户拿到一篇长文想快速看到结构化分段建议。

点"AI 智能分段"按钮 → 调用后端 `/api/split-script` → DeepSeek V4 Pro 分析文案并按叙事节奏切分。

**DeepSeek Prompt 设计**：

```
system: 你是一名资深短视频编导，擅长把长文改写成适合 90-180 秒口播的脚本。
规则：
1. 按叙事节奏切分：开场（钩子）→ 痛点 → 反转 → 高潮 → CTA
2. 每段 10-18 秒（约 38-68 个中文字）
3. 短句、口语化、避免长定语
4. 输出 JSON 数组，每段含 { text, role, suggestedVoice, notes }
5. role 取值：hook / pain / turn / climax / cta
6. suggestedVoice 取值：female-warm / male-deep / female-bright / male-young
7. 保留原文关键信息和语气，不要瞎编

user: {原始文章}
```

**返回示例**：
```json
[
  { "text": "你有没有这种感觉...？", "role": "hook", "suggestedVoice": "female-warm", "notes": "提问式开场" },
  { "text": "上个月我朋友...也遇到了同样的问题。", "role": "pain", "suggestedVoice": "female-warm", "notes": "代入感" },
  { "text": "直到她试了一个方法...", "role": "turn", "suggestedVoice": "female-bright", "notes": "情绪转折" },
  ...
]
```

**前端处理流程**：
1. 用户点"AI 智能分段" → 弹 loading（DeepSeek 思考模式可能 5-15 秒）
2. 返回的 JSON → 自动填充到 `ScriptSegment[]`
3. 每段自动套用 `suggestedVoice`（可在 Step 3 修改）
4. 用户可继续手动调整（合并/拆分/改文案）

**降级策略**：
- 后端无 `DEEPSEEK_API_KEY` → 显示"AI 不可用，请手动分段"
- API 报错 → 保留原文，提示重试
- 返回格式异常 → 显示原文，让用户手动分段

#### 模式 3：AI 提议 + 人工编辑（v0.1.3 协同工作流）⭐ 推荐

适用场景：用户希望 AI 给出初稿，但保留完全控制权。**v0.1.3 默认走这个流程**。

**核心交互**：

```
┌─ Step 2 分段 ────────────────────────────────────────────┐
│                                                            │
│  ✏️ 原文输入（30 段已切分）                                │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 你有没有这种感觉...                                │    │
│  │ 上个月我朋友...                                    │    │
│  │ ...                                                │    │
│  └──────────────────────────────────────────────────┘    │
│                                                            │
│  [ 🤖 AI 智能分段 ]  [ ↩ 恢复原文 ]  [ ⤴ 全部采纳 ]      │
│                                                            │
│  ──────────── AI 提议（10 段） ──────────── 置信度 87%    │
│  ☐ 1. 你有没有这种感觉，每天早上醒来...   [hook]  [编辑]  │
│  ☐ 2. 上个月我朋友也遇到了同样的问题。     [pain]  [编辑]  │
│  ☐ 3. 直到她试了一个方法...                [turn]  [编辑]  │
│  ...                                                       │
│                                                            │
│  [ 采纳选中段  ✓]  [ 全部采纳  ✓✓]  [ 全部拒绝  ✗]       │
│                                                            │
│  ──────────── 已采纳段落（3 段） ────────────            │
│  ① 你有没有这种感觉...   [hook]   5.2s    [✏️] [×]      │
│  ② 上个月我朋友...       [pain]   4.8s    [✏️] [×]      │
│  ④ 直到她试了一个方法... [turn]   6.1s    [✏️] [×]      │
│                                                            │
│  [ + 手动新增段 ]                                         │
└────────────────────────────────────────────────────────────┘
```

**关键交互逻辑**：
1. **AI 提议和原文共存**——AI 提议渲染为可勾选列表，原文渲染为可编辑文本框
2. **逐段采纳**——勾选 AI 提议的某段 → 点"采纳选中段" → 该段进"已采纳段落"
3. **编辑 AI 提议**——点某段的"编辑"按钮 → 弹出编辑器，可改文案/role
4. **手动新增**——"已采纳段落"里点"+ 手动新增段" → 输入文案，加入
5. **混合编辑**——已采纳段可重新编辑文案、可拖拽重排
6. **回退**——"恢复原文"按钮清空所有采纳，回到纯手动模式

**置信度展示**：
- AI 返回每段的 `confidence` 字段（0-1）
- 列表里用色条/星星展示：高（>0.8）绿色、中的（0.5-0.8）黄色、低（<0.5）红色
- 红色段可单独重新生成或直接编辑

**状态机**：

```
初始 ─点"AI 智能分段"→ 加载中
  ├ 成功 ─→ AI 提议列表（未采纳）
  │          ├ 单段采纳 ─→ 加入"已采纳"
  │          ├ 全部采纳 ─→ 替换"已采纳"
  │          └ 全部拒绝 ─→ 回到手动模式
  ├ 失败 ─→ 弹窗错误 + 回到手动模式
  └ 降级（无 Key） ─→ 灰显按钮，提示"未配置 AI"
```

**数据结构**：
```typescript
interface ScriptSegment {
  id: string;
  text: string;
  source: 'manual' | 'ai';     // 区分来源，便于 UI 标识
  role?: 'hook' | 'pain' | 'turn' | 'climax' | 'cta';
  suggestedVoice?: string;
  confidence?: number;          // 0-1，仅 AI 段有
  notes?: string;
}
```

#### 通用操作（三种模式共用）

- 段属性：音色建议、备注、预估时长
- 操作：合并段、拆分段、删除段、上移下移
- 段拖拽重排
- 段内文字实时编辑

**导出物**：`script.txt`（每段一行，空行分隔，不区分 `source`）

### 5.2 模块 B：场景编排

**场景模板库**（内置 8-12 个）：
- 纯色背景 + 大字标题
- 渐变背景 + 居中文字
- 对话气泡（左/右）
- 数据展示（数字+说明）
- 引用块（带引号样式）
- 列表项（要点罗列）
- 人物介绍（圆形头像+简介）
- 章节切换（大数字+章节名）

**场景编辑器**：
- 左侧：场景列表（缩略图卡片）
- 中间：画布（1920×1080 缩放预览）
- 右侧：属性面板
  - 背景设置（纯色/渐变/图片）
  - 文字层（增删改）
  - 动画选择（下拉 + 预览）
  - 持续时长

**可视化画布**：
- 鼠标点击选中元素
- 拖拽改位置（坐标实时显示）
- 拖角改文字大小
- 实时显示动画触发时间

### 5.3 模块 C：时间轴编辑器

**布局**：
```
时间轴 (0s ━━━━━━━━━━━━━━━━ 180s)
  ├ 标尺 (秒/5秒/10秒/30秒 自适应刻度)
  ├ 轨道1: 段 1 - 开场提问       [0:00-0:12]
  ├ 轨道2: 段 2 - 痛点描述       [0:12-0:35]
  ├ 轨道3: 段 3 - 转折           [0:35-0:58]
  └ 轨道4: 段 4 - 高潮 + CTA     [0:58-1:30]
```

**操作**：
- 拖拽段块左右移动 → 改 `start`
- 拖拽段块右边沿 → 改 `end`（自动联动 `actualDuration`）
- 点击段块 → 在右侧属性面板编辑
- 缩放：Ctrl+滚轮 / 工具栏
- 播放头：点击标尺跳转 / 空格键播放/暂停

**联动**：
- 段时长改变 → 自动重算总时长
- 段被删除 → 后续段 start 顺移
- 段被拆分 → 时间轴自动插入新块

### 5.4 模块 C-1：TTS 试听与时长校准（v0.1 新增）

**为什么需要这一步**：HyperFrames 的核心防错位设计是"用 tts.py --timed 测量真实音频时长"。但用户要等本地 `bash render.sh` 才能拿到真实时长——太晚。WebFrames 在前端就把这一步做了：调用小米 MiMo 试听一次，拿到 wav 同时拿到精确时长回填到时间轴。

#### 5.4.1 流程

```
Step 2 完成后
  ↓
Step 3 顶部出现 "TTS 试听" 按钮（橙色，待办）
  ↓
点 "TTS 试听"
  ↓
对每段文案调用后端 /api/tts
  后端 → 小米 MiMo TTS v2.5 → 返回 wav (Base64) + 时长
  ↓
前端把每段 wav 存到 IndexedDB（Blob）
  ↓
把 actualDuration 回填到 ScriptSegment
  ↓
时间轴自动按真实时长重排
  ↓
预览面板播放的是真实音频（不再是估算）
  ↓
按钮变绿色 "已试听" ✓
```

#### 5.4.2 音色库设计（v0.1+ 扩展：预置 + 自建）

**核心抽象**：所有可用音色（包括预置、设计、复刻）在前端是**平级的"音色库"条目**，渲染到下拉框时统一展示。底层按"音色类型"分发到不同的 TTS 引擎 / API。

**音色条目数据结构**：
```typescript
type VoiceEntry =
  | PresetVoice       // MiMo 预置
  | DesignVoice       // MiMo 音色设计（自然语言描述）
  | CloneVoice;       // MiMo 音色复刻（用户上传音频）

interface BaseVoice {
  id: string;              // uuid
  name: string;            // 用户命名，如"我的男声"、"播音员老王"
  type: 'preset' | 'design' | 'clone';
  createdAt: number;
  isDefault?: boolean;     // 项目新建时默认选中的音色
}

interface PresetVoice extends BaseVoice {
  type: 'preset';
  voiceId: string;         // MiMo 音色 ID，如"冰糖"
  language: 'zh' | 'en';
  gender: 'female' | 'male';
  description?: string;    // 用户备注
}

interface DesignVoice extends BaseVoice {
  type: 'design';
  description: string;     // 1-4 句自然语言描述，如"一位年迈的老先生，北方口音..."
  // 关键约束：MiMo 不返回 voice_id，**每次 TTS 调用时都要重新传这个描述**
}

interface CloneVoice extends BaseVoice {
  type: 'clone';
  sampleAudioId: string;   // 关联到 IndexedDB 中存储的音频样本
  sampleDuration?: number;
  // 关键约束：MiMo 不返回 voice_id，**每次 TTS 调用时都要重新传这个音频**
}
```

**v0.1+ 预置音色列表**（来自 MiMo 预置音色，9 种，开箱即用）：

| voiceId | 名称 | 性别 | 语言 | 适合场景 |
|---------|------|------|------|----------|
| `冰糖` | 冰糖（默认） | 女 | 中文 | 故事/情感/科技 |
| `茉莉` | 茉莉 | 女 | 中文 | 活泼/年轻/时尚 |
| `苏打` | 苏打 | 男 | 中文 | 运动/激情/广告 |
| `白桦` | 白桦 | 男 | 中文 | 沉稳/纪录片/严肃 |
| `Mia` | Mia | 女 | 英文 | 英文内容 |
| `Chloe` | Chloe | 女 | 英文 | 英文活泼 |
| `Milo` | Milo | 男 | 英文 | 英文年轻 |
| `Dean` | Dean | 男 | 英文 | 英文成熟 |
| `mimo_default` | MiMo-默认 | - | 跟随集群 | 后备兜底 |

> 注：以上 9 个预置音色在新建项目时**自动注入**到用户的音色库，不可删除（可改本地别名）。

**UI 表现**（音色下拉框）：
```
┌─ 选择音色 ──────────────────────────┐
│  预置音色                             │
│    ● 冰糖  （女·中文）         [默认] │
│    ○ 茉莉  （女·中文）                │
│    ○ 苏打  （男·中文）                │
│    ○ 白桦  （男·中文）                │
│    ○ Mia   （女·英文）                │
│    ...                                │
│                                       │
│  我设计的音色                         │
│    ○ 沉稳大叔（设计·2026-07-02）      │
│    ○ 治愈系女声（设计·2026-07-02）    │
│                                       │
│  我复刻的音色                         │
│    ○ 我自己的声音（复刻·mp3·12s）     │
│    ○ 同事老王（复刻·wav·25s）         │
│                                       │
│  ──────────────────────              │
│  [ + 设计新音色 ]  [ + 复刻新音色 ]   │
└─────────────────────────────────────┘
```

**关键设计决策**：
1. **音色库是全局资源**——存在 IndexedDB 的 `voices` 表（与 `projects` 表平级），所有项目共享
2. **预置音色不可删**——可改本地别名（"冰糖" → "我的女主播"）
3. **自建音色可删除**——删除前提示"使用此音色的 N 段会回退到默认"
4. **音色库跨项目共享**——一次设计/复刻，所有项目都能用
5. **复刻样本音频全局共享**——上传的 mp3/wav 样本存在 IndexedDB 的 `voice_samples` 表（与 `voices` 表平级），不绑定项目；这意味着用户复刻一次，跨多个项目都能用同一份样本（节省存储，避免重复上传）

**复刻样本的存储边界**：
- 样本本体：IndexedDB `voice_samples` 表，`{ id, blob, duration, mimeType, createdAt }`
- 音色条目：IndexedDB `voices` 表，`sampleAudioId` 字段引用样本 id
- 删除样本时：先查 `voices` 表引用计数，>0 时弹窗"此样本被 N 个音色使用，确定删除？"
- 单个样本 ≤ 10MB，全局总配额 ≤ 100MB（超出弹窗警告，建议清理不用的样本）
- 样本**不会**进入导出包——导出的 `tts.py` 需要用户**自己提供**复刻样本（通过 `--sample` 参数）

#### 5.4.3 音色设计 & 音色复刻 UI

**音色设计对话框**（弹窗 + 预览）：
```
┌─ 设计新音色 ─────────────────────────┐
│                                       │
│  名称:  [ 沉稳大叔              ]     │
│                                       │
│  音色描述（1-4 句，覆盖越多越好）:    │
│  ┌─────────────────────────────────┐  │
│  │ 五十多岁的中年男性，嗓音醇厚     │  │
│  │ 略带磁性，语速缓慢而沉稳，       │  │
│  │ 像一位老教授在讲述人生阅历。     │  │
│  └─────────────────────────────────┘  │
│                                       │
│  预设模板:                            │
│    [空灵少女] [新闻主播] [评书先生]   │
│    [深夜电台DJ] [运动解说] [ASMR]     │
│                                       │
│  试听文本:                            │
│  ┌─────────────────────────────────┐  │
│  │ 你有没有这种感觉，每天早上       │  │
│  │ 醒来，不知道自己究竟在为什么     │  │
│  │ 而活。                           │  │
│  └─────────────────────────────────┘  │
│                                       │
│  [ 试听  ▶]  [ 保存到音色库  ✓]       │
│                                       │
│  ⓘ 音色不会保存为 ID，每次 TTS 都     │
│     会重新合成（MiMo API 硬约束）      │
└─────────────────────────────────────┘
```

**音色复刻对话框**：
```
┌─ 复刻音色 ───────────────────────────┐
│                                       │
│  名称:  [ 我自己的声音          ]     │
│                                       │
│  上传参考音频（mp3/wav，≤10MB）:     │
│  ┌─────────────────────────────────┐  │
│  │   📁 拖拽文件到此处              │  │
│  │   或点击选择文件                  │  │
│  │   推荐时长：5-30 秒，纯净人声     │  │
│  └─────────────────────────────────┘  │
│  ✓ voice_sample.wav (12.3s)  [×]     │
│                                       │
│  试听文本:                            │
│  ┌─────────────────────────────────┐  │
│  │ 你好，这是我的音色复刻测试。     │  │
│  └─────────────────────────────────┘  │
│                                       │
│  [ 试听  ▶]  [ 保存到音色库  ✓]       │
└─────────────────────────────────────┘
```

**后端实现**：自建音色和预置音色调的是**同一个** `/api/tts` 接口，区别只在请求体里的 `voiceType` 和附加字段：

```typescript
// POST /api/tts
interface TtsRequest {
  text: string;
  voice: VoiceEntry;        // 完整的音色对象，前端组装好
  speed: 'slow' | 'normal' | 'fast';
  style: StyleOption;
}

interface TtsResponse {
  audioDataUrl: string;     // data:audio/wav;base64,...
  duration: number;         // 真实时长（秒）
  voice: VoiceEntry;        // 回显
  speed: TtsRequest['speed'];
  style: TtsRequest['style'];
}
```

后端按 `voice.type` 分发：
- `preset` → 调 `mimo-v2.5-tts` 模型，user 消息传风格描述
- `design` → 调 `mimo-v2.5-tts-voicedesign` 模型，user 消息传 `voice.description`
- `clone` → 调 `mimo-v2.5-tts-voiceclone` 模型，audio.voice 传 Base64 音频样本

**代码示例**（后端路由）：
```javascript
router.post('/api/tts', async (req, res) => {
  const { text, voice, speed, style } = req.body;

  const modelMap = {
    preset: 'mimo-v2.5-tts',
    design: 'mimo-v2.5-tts-voicedesign',
    clone: 'mimo-v2.5-tts-voiceclone'
  };

  const userPrompt = voice.type === 'design'
    ? voice.description
    : buildStylePrompt(speed, style);

  const audioConfig = { format: 'wav' };
  if (voice.type === 'preset') {
    audioConfig.voice = voice.voiceId;
  } else if (voice.type === 'clone') {
    audioConfig.voice = `data:audio/mpeg;base64,${voice.sampleBase64}`;
  }

  const response = await client.chat.completions.create({
    model: modelMap[voice.type],
    messages: [
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: text }
    ],
    audio: audioConfig
  });

  // ... 返回 wav + duration
});
```

#### 5.4.4 语速 / 风格控制（MiMo 限制下的三档方案）

**核心约束**：小米 MiMo TTS v2.5 **不暴露数值化语速/音量/音调参数**——只能通过文本内嵌的"音频标签"和"风格描述"控制。

**v0.1+ 语速控制**（用户接受三档离散选择）：

| UI 选项 | user 消息内容 | 文本标签插入 |
|---------|--------------|-------------|
| 慢速 0.8x | "Slow, deliberate pace, clear articulation, longer pauses between phrases." | （无需标签） |
| 正常 1.0x | "Natural conversational pace, clear and friendly." | （无需标签） |
| 快速 1.2x | "Slightly faster pace, energetic and efficient." | （无需标签） |

> UI 上是离散的三档按钮/下拉框（不是滑块）。文档中保留"0.8x/1.0x/1.2x"是为了让用户对效果有心理预期。

**v0.1+ 风格控制**（叠加在语速之上）：

| UI 选项 | user 消息内容 | 文本标签插入 |
|---------|--------------|-------------|
| 中性 | "Neutral, balanced delivery." | （无需标签） |
| 激昂 | "Energetic, passionate, rising intonation, emphatic delivery." | （可选 `[激动]`） |
| 温柔 | "Soft, gentle, warm, soothing tone, like reading a bedtime story." | （可选 `[气声]`） |
| 严肃 | "Authoritative, serious, news-anchor style, measured pace." | （无需标签） |
| 悲伤 | "Somber, melancholic, slower pace, with sighs." | `[叹气]` |
| 兴奋 | "Excited, joyful, fast pace with bright rising pitch." | `[激动]` |

> ⚠️ **MiMo 硬约束**：v0.1+ **不暴露数值化音调/音量滑块**。这些只对预设音色有效，对 design/clone 音色部分支持（design 的风格由用户描述决定）。

#### 5.4.5 TTS 引擎选择：MiMo vs edge-tts（v0.1+ 新增）

**设计目标**：让用户**自主选择**用什么 TTS 引擎。

**全局引擎设置**（项目设置页 → "TTS 引擎"）：
- **小米 MiMo TTS v2.5**（默认）：中文效果好、9 个预置音色 + 音色设计/复刻
- **edge-tts**：微软 Edge 引擎、支持数值化语速/音量/音调、英文音色多、无需 API Key

**两者对比**：

| 维度 | MiMo TTS v2.5 | edge-tts |
|------|--------------|----------|
| 价格 | 限时免费 | 免费（基于微软 Edge） |
| 中文效果 | ★★★★★ | ★★★★ |
| 英文效果 | ★★★★ | ★★★★★ |
| 音色数量 | 9 预置 + 用户自建 | 100+ |
| 音色设计/复刻 | ✅（自建音色） | ❌ |
| 数值化语速 | ❌（三档） | ✅（-50% ~ +100%） |
| 数值化音量 | ❌ | ✅ |
| 数值化音调 | ❌ | ✅ |
| 音频标签 | ✅（`[气声]` 等） | ❌ |
| 凭据 | 需 MIMO_API_KEY | 无 |
| 网络依赖 | 需访问小米 API | 需访问微软 API |

**前端实现**：TTS 调用和试听接口按引擎分发：

```typescript
// stores/tts.ts
export const useTtsStore = defineStore('tts', () => {
  const engine = ref<'mimo' | 'edge'>('mimo');  // 全局引擎

  async function listen(text: string, voice: VoiceEntry, options: TtsOptions) {
    if (engine.value === 'mimo') {
      return await mimoClient.tts({ text, voice, ...options });
    } else {
      return await edgeClient.tts({ text, voice, ...options });
    }
  }
});
```

**edge-tts 试听特殊性**：
- 浏览器无法直接调 edge-tts（没有 SDK），必须走**后端代理**
- 后端用 `node-edge-tts` 包（npm）调微软 Edge API
- 返回 wav (mp3) + 时长，逻辑与 MiMo 路径一致

#### 5.4.6 edge-tts 推荐中文子集（v0.1.3 锁定 10 个）

**子集选择理由**：edge-tts 共 9 个 `zh-CN`（普通话）+ 1 个 `zh-HK-WanLungNeural`（港男声）共 10 个，作为**预置锁定**在音色库。剩余的 100+ 音色（英语/小语种/方言）v0.1 不做引导，用户可在音色库"添加 edge-tts 音色"里按 ShortName 自定义。

**v0.1.3 edge-tts 中文子集**（10 个）：

| ShortName | 名称 | 性别 | 风格描述 | 推荐场景 |
|-----------|------|------|----------|----------|
| `zh-CN-XiaoxiaoNeural` | 晓晓 | 女 | 温柔甜美，主流女声 | 故事/情感/科普（默认） |
| `zh-CN-XiaoyiNeural` | 晓伊 | 女 | 活泼开朗，少女感强 | 时尚/年轻/广告 |
| `zh-CN-YunxiNeural` | 云希 | 男 | 阳光温暖，年轻男声 | 校园/年轻/科技 |
| `zh-CN-YunjianNeural` | 云健 | 男 | 浑厚有力，体育解说风 | 运动/激情/广告 |
| `zh-CN-YunyangNeural` | 云扬 | 男 | 沉稳专业，新闻主播风 | 新闻/纪录片/严肃 |
| `zh-CN-YunxiaNeural` | 云夏 | 男 | 温和亲切，文艺青年 | 散文/治愈/小说 |
| `zh-CN-liaoning-XiaobeiNeural` | 晓北（东北） | 女 | 豪爽直率，东北口音 | 搞笑/方言/小品 |
| `zh-CN-shaanxi-XiaoniNeural` | 晓妮（陕西） | 女 | 朴实憨厚，陕西方言 | 民俗/乡土/方言 |
| `zh-HK-HiuGaaiNeural` | 晓佳（粤语） | 女 | 温柔知性，香港口音 | 粤语内容 |
| `zh-HK-WanLungNeural` | 云朗（粤语） | 男 | 沉稳大气，港男主播风 | 粤语新闻/纪录片 |

**UI 表现**：在"添加 edge-tts 音色"弹窗里，10 个推荐音色以**卡片网格**呈现，每个带"试听"按钮；选完后用户可改名（默认显示 ShortName 去掉后缀的"晓晓"等）。

**添加自定义 edge-tts 音色**：弹窗 → "通过 ShortName 添加" → 输入 `zh-CN-XiaomengNeural`（举例）→ 试听 → 保存到音色库。

**edge-tts 的数值化控制参数**（v0.1.3 暴露，v0.1.3 之前未实现）：

| 参数 | 取值范围 | 默认 | UI 控件 | 适用引擎 |
|------|----------|------|---------|----------|
| `rate` | `-50%` ~ `+100%` | `+0%` | 滑块（步进 5%） | edge-tts only |
| `volume` | `-50%` ~ `+50%` | `+0%` | 滑块（步进 5%） | edge-tts only |
| `pitch` | `-50Hz` ~ `+50Hz` | `+0Hz` | 滑块（步进 5Hz） | edge-tts only |

> 选 MiMo 引擎时，这三个控件**隐藏**（MiMo 不支持数值化控制）。

**音色库条目类型扩展**：

```typescript
type VoiceEntry =
  | PresetVoice       // MiMo 预置
  | DesignVoice       // MiMo 音色设计
  | CloneVoice        // MiMo 音色复刻
  | EdgeTtsVoice;     // v0.1.3 新增

interface EdgeTtsVoice extends BaseVoice {
  type: 'edge-tts';
  shortName: string;       // 如 'zh-CN-XiaoxiaoNeural'
  language: 'zh-CN' | 'zh-HK' | 'zh-TW' | 'en-US' | 'en-GB' | string;
  gender: 'female' | 'male';
  // 引擎级参数（覆盖全局设置）
  rateOverride?: string;   // '-20%'
  volumeOverride?: string;
  pitchOverride?: string;
}
```

#### 5.4.7 双引擎切换策略

**全局引擎**（项目设置里选）：MiMo 或 edge-tts。

**切换引擎时的行为**：
- 切换后**不重置已配置的音色**——如果当前段配的是 MiMo 预置"冰糖"，切到 edge-tts 后该段标记为"音色不兼容"（红色警告），用户可重新选 edge-tts 音色
- 已试听的音频**保留**（按段 id 存），不会因为切换引擎而丢
- 时间轴上未试听段保持"--.--"

**单段覆盖引擎**（v0.1.3 支持）：单段可单独指定引擎，覆盖全局。右键段 → "用 edge-tts 试听本段"。导出的项目包里单段引擎信息写进 `webframes.config.json.segments[]`。

**导出包的双引擎 tts.py**：
- 引擎选择写进 `webframes.config.json`
- `tts.py` 启动时读配置，路由到对应 SDK
- 同一份 `script.txt` 和 `timeline.json`，两个引擎都能跑

#### 5.4.8 后端 API 设计

**POST `/api/tts`**：

请求（MiMo 引擎，preset 音色示例）：
```json
{
  "engine": "mimo",
  "text": "你有没有这种感觉？",
  "voice": {
    "id": "preset-bingtang",
    "type": "preset",
    "name": "冰糖",
    "voiceId": "冰糖"
  },
  "speed": "normal",
  "style": "gentle"
}
```

请求（MiMo 引擎，design 音色示例）：
```json
{
  "engine": "mimo",
  "text": "你有没有这种感觉？",
  "voice": {
    "id": "design-uuid-001",
    "type": "design",
    "name": "沉稳大叔",
    "description": "五十多岁的中年男性，嗓音醇厚略带磁性..."
  },
  "speed": "normal",
  "style": "neutral"
}
```

请求（MiMo 引擎，clone 音色示例）：
```json
{
  "engine": "mimo",
  "text": "你有没有这种感觉？",
  "voice": {
    "id": "clone-uuid-002",
    "type": "clone",
    "name": "我自己的声音",
    "sampleBase64": "data:audio/mpeg;base64,SUQz..."
  },
  "speed": "normal",
  "style": "neutral"
}
```

请求（edge-tts 引擎）：
```json
{
  "engine": "edge",
  "text": "你有没有这种感觉？",
  "voice": {
    "id": "edge-zh-XiaoxiaoNeural",
    "type": "preset",
    "name": "晓晓",
    "voiceId": "zh-CN-XiaoxiaoNeural"
  },
  "speed": "normal",
  "rate": "0%",
  "volume": "0%",
  "pitch": "0Hz"
}
```

后端处理：
```javascript
// packages/backend/src/routes/tts.js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.MIMO_API_KEY,
  baseURL: 'https://api.xiaomimimo.com/v1'
});

router.post('/api/tts', async (req, res) => {
  const { text, voice, speed, style } = req.body;

  const userPrompt = buildStylePrompt(speed, style);  // 拼接"风格描述"

  const response = await client.chat.completions.create({
    model: 'mimo-v2.5-tts',
    messages: [
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: text }
    ],
    audio: { format: 'wav', voice: voice || '冰糖' }
  });

  const wavBase64 = response.choices[0].message.audio.data;
  const wavBuffer = Buffer.from(wavBase64, 'base64');

  // 测量真实时长（用 wav 头部解析，或用 ffprobe）
  const duration = await measureWavDuration(wavBuffer);

  res.json({
    audioDataUrl: `data:audio/wav;base64,${wavBase64}`,
    duration,
    voice,
    speed,
    style
  });
});
```

**GET `/api/voices`**：返回预置音色列表（前端初始化时拉取）。

#### 5.4.9 前端 UI 集成（v0.1+ 整合）

**位置**：Step 3 顶部固定的"TTS 试听"侧边栏，跨 Step 3 / Step 4 可见。

**全局设置区**：
```
┌─ TTS 试听面板 ──────────────────────────────┐
│  引擎:    [● 小米 MiMo] [  edge-tts ]        │
│  音色库:  [● 冰糖（女·中文）     ▼]         │
│  语速:    [ 慢 ] [● 正常 ] [ 快 ]            │
│  风格:    [ 中性 ] [● 温柔 ] [ 激昂 ] ...    │
│  [▶ 全部试听]  [⏹ 停止]  [⚙ 音色库管理]     │
├──────────────────────────────────────────────┤
│ 段落 1: "你有没有这种感觉？"                 │
│  音色: 冰糖（女） | 时长: --.--              │
│  [▶ 试听本段]  [🔄 重新生成]  [✏ 改音色]    │
│                                               │
│ 段落 2: "上个月我朋友..."                     │
│  音色: 沉稳大叔（设计） | 时长: 5.2s ✓         │
│  [▶ 试听本段]  [🔄 重新生成]  [✏ 改音色]    │
│  ...                                          │
└──────────────────────────────────────────────┘
```

**edge-tts 引擎下的特殊 UI**（切换引擎后自动替换"语速"和"风格"行）：
```
│  语速:    [────●────] 0%  (-50% ~ +100%)     │
│  音量:    [────●────] 0%  (-50% ~ +50%)      │
│  音调:    [────●────] 0Hz (-50Hz ~ +50Hz)    │
```

**核心交互**：
- "全部试听"：并发调用（限制 3 并发），逐段填充
- "试听本段"：单段生成 + 播放
- "重新生成"：覆盖当前段音频
- 时长显示：未试听显示 `--.--`，已试听显示精确秒数（绿色 ✓）
- 全局音色/语速修改后，未试听的段标"待重新生成"
- **引擎切换**：项目设置里切换 MiMo/edge，UI 立即重渲染（TTS 试听请求自动用新引擎）

**音色库管理弹窗**（点 "⚙ 音色库管理" 打开）：
```
┌─ 我的音色库 ─────────────────────────────┐
│                                           │
│  [ 预置音色 ] [ 我设计的 ] [ 我复刻的 ]   │
│  ─────────────────────────────           │
│  ● 冰糖  （女·中文）  [默认] [改名]      │
│  ○ 茉莉  （女·中文）  [改名]              │
│  ○ 苏打  （男·中文）  [改名]              │
│  ○ 白桦  （男·中文）  [改名]              │
│  ○ Mia   （女·英文）  [改名]              │
│  ...                                      │
│                                           │
│  [ + 设计新音色 ]  [ + 复刻新音色 ]       │
│                              [关闭]        │
└──────────────────────────────────────────┘
```

#### 5.4.10 导出项目包中的 tts.py（v0.1+ 双引擎）

**关键变化**：v0.1+ 导出的 `tts.py` 内部按 `webframes.config.json` 的 `ttsEngine` 字段路由到不同 SDK，**同一份 script.txt 走不同引擎都能渲染**。

**导出包结构**：
```
webframes-export-xxx.zip
├── index.html
├── hyperframes.json
├── webframes.config.json     # v0.1+ 新增：引擎/音色等配置
├── script.txt                # 纯文本（已含音频标签）
├── segments/                 # 浏览器已试听 → 已生成 wav 打包
│   ├── 001.wav
│   ├── 002.wav
│   └── ...
├── voice-samples/            # v0.1+ 新增：复刻音色的样本音频
│   ├── my_voice_sample.mp3
│   └── ...
├── tts.py                    # v0.1+ 重写：双引擎路由入口
├── tts_mimo.py               # v0.1+ 新增：MiMo 引擎实现（preset/design/clone）
├── tts_edge.py               # v0.1+ 新增：edge-tts 引擎实现
├── concat_segments.py        # 拼接脚本
├── package.json
├── render.sh
├── .env.example              # MIMO_API_KEY=your_key（edge-tts 无需 key）
└── README.md
```

**`webframes.config.json` 示例**：
```json
{
  "ttsEngine": "mimo",
  "defaultVoice": {
    "id": "preset-bingtang",
    "type": "preset",
    "voiceId": "冰糖"
  },
  "defaultSpeed": "normal",
  "defaultStyle": "gentle",
  "voices": [
    {
      "id": "preset-bingtang",
      "type": "preset",
      "name": "冰糖",
      "voiceId": "冰糖"
    },
    {
      "id": "design-uuid-001",
      "type": "design",
      "name": "沉稳大叔",
      "description": "五十多岁中年男性..."
    },
    {
      "id": "clone-uuid-002",
      "type": "clone",
      "name": "我自己的声音",
      "sampleFile": "voice-samples/my_voice_sample.mp3"
    }
  ]
}
```

**`tts.py` 路由逻辑**（v0.1+ 关键代码片段）：
```python
import json, os
from pathlib import Path

# 读配置
config = json.loads(Path("webframes.config.json").read_text())
engine = config.get("ttsEngine", "mimo")

# 按引擎路由
if engine == "mimo":
    from tts_mimo import synthesize_segment
elif engine == "edge":
    from tts_edge import synthesize_segment
else:
    raise ValueError(f"Unknown engine: {engine}")

# 读音色表
voices = {v["id"]: v for v in config.get("voices", [])}

# 逐段合成
for i, line in enumerate(open("script.txt"), 1):
    voice_id = line_voice_map.get(i) or config["defaultVoice"]["id"]
    voice = voices[voice_id]
    out_path = f"segments/{i:03d}.wav"
    synthesize_segment(text=line.strip(), voice=voice, output=out_path)
```

**新工作流**（用户本地）：
```bash
# 1. 安装依赖
pip install openai edge-tts pydub

# 2. 配置 .env（仅 MiMo 引擎需要）
cp .env.example .env
# 编辑 .env 填入 MIMO_API_KEY（如用 edge-tts 可跳过）

# 3. （可选）重新生成每段音频（如果导出的 segments/ 已有 wav，可跳过）
python3 tts.py

# 4. 拼接成完整 narration.wav（保留精确时间戳）
python3 concat_segments.py script.txt segments/ narration.wav timeline.json

# 5. 渲染
npx hyperframes render
```

**引擎切换的导出包复用**：
- 用户 A 用 MiMo 导出包 → 想换 edge-tts 渲染：只改 `webframes.config.json` 的 `ttsEngine`，删 `segments/`，跑 `python3 tts.py`
- 反之亦然
- `webframes.config.json` 和 `voice-samples/` 是切换的唯一需要改动的东西

### 5.5 模块 D：实时预览面板

**核心机制**：
- 内部维护一份"导出器的简化版"：把当前 `project` 状态实时编译为 `index.html` 字符串
- 字符串塞进 `iframe.srcDoc`（无 src，更快）
- 父页面通过 `postMessage` 发 `{ type: 'play' | 'pause' | 'seek', time }`
- iframe 内 `window.__hf_rendering` 守卫包裹预览逻辑（与原 HyperFrames 一致）

**预览控件**：
- ▶ 播放 / ⏸ 暂停 / ↺ 重播
- 时间码显示 `MM:SS / MM:SS`
- 音量条
- 全屏按钮

**性能优化**：
- `requestIdleCallback` 节流编译（每秒最多 4 次）
- 编译产物缓存（哈希对比）
- iframe 不重新创建，只更新 `srcdoc`

### 5.6 模块 E：项目导出器

**打包内容**：
```
webframes-export-20260702-220630.zip
├── index.html              # 主视频编排页面（编译自 project）
├── hyperframes.json        # 视频规格
├── script.txt              # 脚本
├── timeline.json           # 精确时间戳
├── tts.py                  # TTS 脚本（从 Skill 复制）
├── package.json
├── render.sh               # 一键渲染
├── README.md               # 使用说明
└── .env.example            # 凭据模板（如果用腾讯云 TTS）
```

**生成逻辑**：
- `index.html`：调用与预览面板**同一个**编译函数，保证所见即所得
- `hyperframes.json`：写入 width/height/fps/duration/audioSources
- `script.txt`：每段一行，空行分隔
- `timeline.json`：每段 `{ index, start, end, text }`（基于估算时长，标注"请用 tts.py --timed 覆盖"）
- `tts.py` / `package.json` / `render.sh`：从 WebFrames 内嵌的模板字符串生成

**导出体验**：
- 点"导出"按钮 → 弹窗预览包内文件清单
- 点"下载" → 浏览器下载 .zip
- 同时显示"接下来要做的事"清单：
  ```
  1. 解压 .zip
  2. cd webframes-export-xxx
  3. python3 tts.py --timed script.txt narration.wav
  4. 把终端输出的 JS 代码段粘贴到 index.html SUBTITLES 数组
  5. npx hyperframes render
  6. 等待完成，renders/output.mp4 就是你的视频
  ```

---

## 6. 状态管理设计

### 6.1 Pinia Store 划分

```typescript
// stores/project.ts - 项目元数据
useProjectStore()
  ├── project: Ref<Project>
  ├── currentStep: Ref<'input' | 'script' | 'scenes' | 'timeline'>
  ├── selectedSegmentId, selectedSceneId
  ├── actions: createProject, loadProject, saveProject, updateMeta

// stores/script.ts - 脚本段落
useScriptStore()
  ├── segments: Ref<ScriptSegment[]>
  ├── actions: splitText, mergeSegments, reorder, updateText

// stores/scenes.ts - 视觉场景
useScenesStore()
  ├── scenes: Ref<SceneConfig[]>
  ├── templates: Ref<SceneTemplate[]>
  ├── actions: addScene, applyTemplate, updateScene

// stores/timeline.ts - 时间轴
useTimelineStore()
  ├── entries: Ref<TimelineEntry[]>
  ├── playhead: Ref<number>
  ├── isPlaying: Ref<boolean>
  ├── actions: addEntry, moveEntry, resizeEntry, seek

// stores/preview.ts - 预览状态
usePreviewStore()
  ├── compiledHtml: Ref<string>
  ├── isDirty: Ref<boolean>
  ├── actions: compile, invalidate
```

### 6.2 数据持久化

- **自动保存**：每 5 秒把 `Project` 序列化为 JSON 写入 IndexedDB
- **手动保存**：顶栏 💾 按钮 → 立即保存 + 提示
- **加载**：项目启动时从 IndexedDB 读最近一个项目
- **导入/导出**：菜单 → 导入 .json / 导出 .json / 导出 .zip

---

## 7. 关键交互流程

### 7.1 从零开始做一个视频

```
1. 打开 WebFrames → 自动加载上次项目（或新建空项目）
2. 顶栏改名 "我的视频"
3. Step 1: 粘贴一篇 800 字文章
4. Step 2: 点 "AI 智能分段" → DeepSeek 按节奏切分 → 12 段
   （可手动微调合并/拆分/改文案）
5. 点 "TTS 试听" → 对每段调用小米 MiMo → 拿到真实时长回填
   （可选：调整全局音色/语速后重新生成）
6. Step 3: 选段 1 → 选"纯色背景+大字标题"模板 → 输入标题
7. 选段 2 → 选"渐变背景+居中文字" → 输入内容
8. ... 重复
9. Step 4: 时间轴已用真实时长自动对齐，可微调起止
10. 右侧预览面板点 ▶ 看效果（播放真实 TTS 音频）
11. 调满意 → 点"导出" → 下载 .zip（含每段 wav + tts.py）
12. 本地解压 → 跑 .env 配置 MIMO_API_KEY → npx hyperframes render
```

### 7.2 修改已有项目

```
1. 顶栏菜单 → 打开 → 选上次导出的 .zip 或 .json
2. 自动跳到上次编辑的步骤
3. 修改文案/场景/时间轴
4. 预览确认
5. 重新导出
```

---

## 8. 视觉与交互设计

### 8.1 设计语言

- **风格**：现代极简，参考 Linear / Figma / Vercel Dashboard
- **配色**：
  - 主色：`#5B8DEF`（蓝）
  - 背景：`#0E1116`（深） / `#FFFFFF`（浅）
  - 文字：`#F4F4F5` / `#1F2937`
  - 强调：`#22C55E`（成功）/ `#EF4444`（错误）
- **主题**：默认深色，跟 HyperFrames 视频画面的深色基调一致
- **字体**：系统字体栈（`-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`）

### 8.2 关键 UI 规范

- **画布尺寸**：预览面板固定 16:9，按宽度自适应缩放
- **拖拽反馈**：被拖元素半透明（opacity 0.6），目标位置高亮
- **时间轴**：1px 像素 = 视频 0.1 秒，刻度自适应
- **场景画布**：1920×1080 全尺寸编辑，缩略图 320×180 卡片
- **加载态**：所有异步操作有 spinner，文案说明进度

### 8.3 响应式

- **v0.1 范围**：仅桌面端（≥1280px 宽）
- 时间轴编辑器是核心，移动端体验难做好，先做透桌面

---

## 9. 项目结构

```
webframes/                                # monorepo 根目录
├── pnpm-workspace.yaml
├── package.json                          # 根 package.json（dev 脚本）
├── .env.example                          # 后端凭据模板
├── .gitignore
├── README.md
│
├── packages/
│   │
│   ├── frontend/                         # Vue 3 SPA
│   │   ├── public/
│   │   │   └── favicon.svg
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── App.vue
│   │   │   ├── stores/                   # Pinia
│   │   │   │   ├── project.ts
│   │   │   │   ├── script.ts
│   │   │   │   ├── scenes.ts
│   │   │   │   ├── timeline.ts
│   │   │   │   ├── tts.ts                # v0.1 新增：TTS 状态
│   │   │   │   └── preview.ts
│   │   │   ├── views/
│   │   │   │   ├── Step1Input.vue
│   │   │   │   ├── Step2Script.vue
│   │   │   │   ├── Step3Scenes.vue
│   │   │   │   └── Step4Timeline.vue
│   │   │   ├── components/
│   │   │   │   ├── common/
│   │   │   │   │   ├── TopBar.vue
│   │   │   │   │   ├── Sidebar.vue
│   │   │   │   │   └── StatusBar.vue
│   │   │   │   ├── preview/
│   │   │   │   │   ├── PreviewFrame.vue
│   │   │   │   │   └── PreviewControls.vue
│   │   │   │   ├── timeline/
│   │   │   │   │   ├── TimelineRuler.vue
│   │   │   │   │   ├── TimelineTrack.vue
│   │   │   │   │   └── SegmentBlock.vue
│   │   │   │   ├── scene/
│   │   │   │   │   ├── SceneCanvas.vue
│   │   │   │   │   ├── SceneCard.vue
│   │   │   │   │   └── PropertyPanel.vue
│   │   │   │   ├── tts/                  # v0.1 新增：TTS 试听 UI
│   │   │   │   │   ├── TtsPanel.vue
│   │   │   │   │   ├── TtsSegmentRow.vue
│   │   │   │   │   └── VoiceSelector.vue
│   │   │   │   └── export/
│   │   │   │       └── ExportDialog.vue
│   │   │   ├── composables/
│   │   │   │   ├── useCompiler.ts        # 核心：project → HTML
│   │   │   │   ├── useTts.ts             # v0.1 新增：TTS 调用
│   │   │   │   ├── useAiSplit.ts         # v0.1 新增：AI 分段
│   │   │   │   ├── usePersistence.ts
│   │   │   │   ├── useShortcuts.ts
│   │   │   │   └── usePostMessage.ts
│   │   │   ├── compiler/
│   │   │   │   ├── index.ts
│   │   │   │   ├── compile-html.ts
│   │   │   │   ├── compile-json.ts
│   │   │   │   ├── compile-script.ts
│   │   │   │   ├── compile-timeline.ts
│   │   │   │   └── templates/
│   │   │   │       ├── index-html.template
│   │   │   │       ├── render.sh.template
│   │   │   │       ├── tts.py.template          # v0.1+ 改：MiMo/edge 双引擎
│   │   │   │       ├── tts_mimo.py.template   # MiMo 引擎片段
│   │   │   │       ├── tts_edge.py.template   # edge-tts 引擎片段
│   │   │   │       └── concat_segments.py.template  # v0.1 新增
│   │   │   ├── templates/                # 场景模板
│   │   │   │   ├── index.ts
│   │   │   │   ├── title.ts
│   │   │   │   ├── gradient.ts
│   │   │   │   ├── dialogue.ts
│   │   │   │   ├── data.ts
│   │   │   │   └── voice-design-prompts.ts  # v0.1+ 新增：6 个音色设计模板
│   │   │   ├── types/
│   │   │   │   ├── project.ts
│   │   │   │   ├── scene.ts
│   │   │   │   ├── timeline.ts
│   │   │   │   └── voice.ts                # v0.1+ 新增：VoiceEntry 类型
│   │   │   ├── utils/
│   │   │   │   ├── duration.ts
│   │   │   │   ├── zip.ts
│   │   │   │   ├── idb.ts                 # 含 wav Blob 存储
│   │   │   │   ├── voice-store.ts         # v0.1+ 新增：IndexedDB voices 表
│   │   │   │   └── tts-style.ts           # v0.1 新增：风格 prompt 拼装
│   │   │   ├── api/                       # v0.1 新增：后端 API 客户端
│   │   │   │   ├── client.ts
│   │   │   │   ├── tts.ts                 # 双引擎分发
│   │   │   │   ├── voices.ts
│   │   │   │   └── split.ts
│   │   │   ├── assets/
│   │   │   │   └── styles/
│   │   │   │       ├── global.css
│   │   │   │       └── variables.css
│   │   │   └── router.ts
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── .env.development               # VITE_API_BASE=http://localhost:4000
│   │
│   └── backend/                          # Node.js Express 代理
│       ├── src/
│       │   ├── index.ts                  # 入口
│       │   ├── app.ts                    # Express app
│       │   ├── config.ts                 # 读 .env
│       │   ├── routes/
│       │   │   ├── health.ts
│       │   │   ├── split-script.ts       # /api/split-script → DeepSeek
│       │   │   ├── tts.ts                # /api/tts → MiMo / edge-tts
│       │   │   └── voices.ts             # /api/voices
│       │   ├── services/
│       │   │   ├── deepseek.ts           # DeepSeek 客户端封装
│       │   │   ├── mimo.ts               # MiMo TTS 客户端封装
│       │   │   ├── edge-tts.ts           # v0.1+ 新增：edge-tts 客户端封装
│       │   │   ├── voice-factory.ts      # v0.1+ 新增：按 voice.type 路由
│       │   │   └── style-prompts.ts      # 语速/风格 → user 消息
│       │   ├── utils/
│       │   │   ├── wav-duration.ts       # 解析 wav 头部拿真实时长
│       │   │   └── wav-convert.ts        # v0.1+ 新增：edge-tts mp3 → wav
│       │   └── types/
│       │       └── index.ts
│       ├── package.json
│       ├── tsconfig.json
│       ├── .env.example
│       └── README.md
│
└── docs/
    ├── PROJECT_DESIGN.md                 # 本文档
    └── ARCHITECTURE.md                   # 架构图（可选）
```

---

## 10. 核心算法：编译 project → index.html

这是整个项目的**灵魂函数**，必须保证：
- 编译产物与原 HyperFrames 项目结构 100% 兼容
- 同一份 project 数据，编译出的 HTML 在预览和导出中完全一致

```typescript
// compiler/compile-html.ts
export function compileHtml(project: Project): string {
  const {
    width, height, fps,
    script, scenes, timeline, theme
  } = project;

  // 1. 生成场景 HTML
  const scenesHtml = scenes.map(s => renderScene(s)).join('\n');

  // 2. 生成 SUBTITLES 数组
  const subtitlesJs = timeline.map((entry, i) => {
    const seg = script.find(s => s.id === entry.segmentId)!;
    return `  { index: ${i}, start: ${entry.start.toFixed(1)}, end: ${entry.end.toFixed(1)}, text: "${esc(seg.text)}" }`;
  }).join(',\n');

  // 3. 生成场景切换 + 动画 GSAP 代码
  const sceneLogicJs = timeline.map(entry => {
    const sceneId = `scene-${entry.sceneId}`;
    return `
      master.set("#${sceneId}", { display: "flex" }, ${entry.start});
      master.set("#${sceneId}", { display: "none" }, ${entry.end});
    `;
  }).join('');

  const animLogicJs = scenes.map(scene =>
    renderAnimations(scene)
  ).join('\n');

  // 4. 套模板
  return indexHtmlTemplate
    .replace('{{TITLE}}', esc(project.name))
    .replace('{{WIDTH}}', String(width))
    .replace('{{HEIGHT}}', String(height))
    .replace('{{SCENES}}', scenesHtml)
    .replace('{{SUBTITLES}}', subtitlesJs)
    .replace('{{SCENE_LOGIC}}', sceneLogicJs)
    .replace('{{ANIM_LOGIC}}', animLogicJs)
    .replace('{{SUBTITLE_STYLE}}', renderSubtitleStyle(theme))
    .replace('{{BODY_STYLE}}', renderBodyStyle(theme));
}
```

预览面板和导出器**共用这一个函数**——这是"所见即所得"的核心保证。

---

## 11. 开发路线图

### 11.1 v0.1.3 MVP（3-4 周）

**目标**：跑通"粘贴文案 → AI 提议+人工分段 → TTS 试听（MiMo/edge 双引擎 + 音色设计/复刻）→ 配场景 → 看真实音频预览 → 导出双引擎项目包"全流程

**Phase A：脚手架 + 基础 UI（1 周）**
- [ ] monorepo 脚手架（pnpm workspace）
- [ ] 前端：Vite + Vue 3 + TS + Pinia + Naive UI
- [ ] 后端：Express + TypeScript + dotenv + cors
- [ ] 数据模型 + TypeScript 类型（含 VoiceEntry 四种类型：preset/design/clone/edge）
- [ ] TopBar / Sidebar / StatusBar 通用组件
- [ ] 4 步路由 + 步骤切换逻辑

**Phase B：编辑器核心 + 分段（1 周）**
- [ ] Step 1: 文案输入 + 字数统计 + 预估时长
- [ ] Step 2 模式 1：手动分段 + 拖拽重排
- [ ] Step 2 模式 2：AI 智能分段（DeepSeek V4 Pro）
- [ ] **Step 2 模式 3：AI 提议 + 人工编辑协同（v0.1.3 重点）**
  - [ ] AI 提议列表 + 置信度展示
  - [ ] 逐段采纳 / 全部采纳 / 全部拒绝
  - [ ] 已采纳段可手动编辑、拖拽、新增
  - [ ] `ScriptSegment.source` 字段区分来源
- [ ] Step 3: 4 个基础场景模板 + 属性面板
- [ ] Step 4: 时间轴（拖拽改起止、播放头）
- [ ] IndexedDB 自动保存（含 `voices` 表 + `voice_samples` 表 + 项目数据）

**Phase C：TTS 试听 + 预览（1.5 周）**
- [ ] 后端 `/api/tts` 引擎分发（MiMo preset/design/clone + edge-tts）
- [ ] 后端 `/api/voices`（9 预置 + edge 10 个中文子集 + edge 完整列表查询）
- [ ] 后端 `/api/split-script`（DeepSeek V4 Pro + 返回 `confidence` 字段）
- [ ] 前端 TTS 引擎选择器（项目设置）
- [ ] 前端音色库管理（IndexedDB voices 表 + 自建设计/复刻弹窗）
  - [ ] **edge-tts 10 个中文子集预置锁定**（v0.1.3）
  - [ ] edge-tts 自定义 ShortName 添加
  - [ ] MiMo 音色设计对话框（描述 + 6 模板 + 试听）
  - [ ] MiMo 音色复刻对话框（拖拽上传 + 试听 + 引用计数）
  - [ ] 复刻样本 `voice_samples` 表（全局共享 + 配额管理）
- [ ] 前端 TTS 试听面板（音色 + 语速 + 风格/数值参数）
- [ ] 前端 useTts composable（并发 3 限流 + 缓存）
- [ ] 真实时长回填到时间轴
- [ ] 实时预览面板（iframe srcdoc + postMessage）

**Phase D：导出 + 联调（0.5 周）**
- [ ] tts.py 模板（双引擎路由：MIMO_ENGINE=mimo/edge）
- [ ] tts_mimo.py 片段（preset/design/clone 分发）
- [ ] tts_edge.py 片段（node-edge-tts 包装）
- [ ] concat_segments.py 模板（拼接 + 输出精确 timeline.json）
- [ ] 导出器打包 .zip
  - [ ] MiMo 引擎：包含音色样本 wav/mp3
  - [ ] edge 引擎：不包含样本（edge 不需要）
- [ ] README + .env.example
- [ ] 端到端联调：浏览器编辑 → 导出 → 本地渲染（两个引擎都跑通）

### 11.2 v0.2 增强（可选）

- [ ] 场景模板扩到 12 个
- [ ] 多轨道时间轴（视频+文字+特效分轨）
- [ ] 关键帧动画（不只是入场/退场）
- [ ] 素材库（图片/图标上传）
- [ ] 项目模板（开箱即用的"科普视频"模板）
- [ ] 导出 dash 文件名（音轨单独 wav 列表）
- [ ] AI 文案润色 / 标题生成

### 11.3 v0.3 协作（远期）

- [ ] 多人协作（Yjs CRDT）
- [ ] 云端项目存储
- [ ] 一键发布到抖音/视频号
- [ ] 视频模板市场

---

## 12. 风险与决策记录

### 12.1 已决策

| 决策 | 备选 | 选择 | 理由 |
|------|------|------|------|
| 框架 | Vue / React | **Vue 3** | 用户指定 |
| UI 库 | Element Plus / Naive UI / 自研 | **Naive UI** | Vue 3 原生，TS 友好 |
| 状态管理 | Pinia / Vuex / provide/inject | **Pinia** | 官方推荐 |
| 渲染位置 | 浏览器 / 走 CLI | **走 CLI** | 沙箱限制 + 字体兼容性 |
| 持久化 | localStorage / IndexedDB / 云端 | **IndexedDB** | 项目可能大，LS 容量不够 |
| 导出格式 | 单 HTML / 完整项目包 | **完整项目包** | 与 HyperFrames 100% 兼容 |
| TTS 引擎 | edge-tts / 腾讯云 / 小米 MiMo | **MiMo 主 + edge-tts 备** | 双引擎：MiMo 音色丰富/中文强；edge 数值化参数多 |
| LLM | GPT-4 / Claude / DeepSeek | **DeepSeek V4 Pro** | 用户指定 + 中文好 + 性价比 |
| API Key 存储 | 前端 .env / 后端 .env | **后端 .env** | 安全 + 不暴露 |
| 仓库结构 | 单包 / monorepo | **monorepo (pnpm workspace)** | 前端+后端共享类型 |
| TTS 凭据传递 | 用户填本地 / 浏览器输入 | **导出包 .env.example** | 用户本地跑 tts.py 时自己填 |
| 语速控制（MiMo） | 数值参数 / 风格描述 | **风格描述（user 消息）三档** | MiMo 硬约束，无数值参数 |
| 语速控制（edge） | 数值百分比 | **-50% ~ +100% 滑块** | edge-tts 支持 |
| 音色库架构 | 全局/项目级 | **全局 IndexedDB（跨项目共享）** | 一次设计/复刻，所有项目能用 |
| MiMo 音色设计/复刻 | 不支持 / 支持 | **支持（每次重传描述/音频）** | MiMo 不返回 voice_id 硬约束 |
| 复刻样本存储范围 | 项目内 / 全局 | **全局 `voice_samples` 表** | 用户确认：一次复刻全浏览器共享 |
| 复刻样本随项目导出 | 是 / 否 | **否** | 用户确认：导出时只导出音色条目（描述/引用），样本由用户本地提供 |
| edge-tts 中文子集 | 全部 100+ / 锁定子集 | **锁定 10 个中文子集** | 用户确认：9 zh-CN + 1 zh-HK |
| 分段模式 | 仅 AI / 仅手动 / 双模式 | **三模式（手动/AI/AI+人工协同）** | 用户确认：默认走协同模式 |

### 12.2 待讨论（v0.2+ 评估）

| 问题 | 当前默认 | 备选 |
|------|----------|------|
| 是否支持组件化场景（拖入 Vue 组件作为场景内容） | v0.1 不做 | v0.2 评估 |
| AI 助手放在哪一步 | Step 2 一键"AI 智能分段" | 每步都有 AI 助手按钮 |
| edge-tts 音色列表是拉一次缓存还是每次都拉 | v0.1 启动时拉一次 | 每次打开音色下拉框时拉 |
| 是否支持 Web Speech API（浏览器原生 TTS）作为离线兜底 | v0.1 不做 | v0.2 评估（需解决音量/音调参数缺失） |

### 12.3 已知风险

1. **iframe srcdoc 性能**：长视频（>5 分钟）预览可能卡顿
   - 缓解：编译节流 + 简化预览 HTML（不带水印、不带粒子）
2. **场景编辑器体验**：纯靠坐标拖拽对非设计师不友好
   - 缓解：场景模板降低门槛，预留 v0.2 接入 AI 文生图
3. **导出与预览不一致**：编译逻辑有 bug 时可能预览看着对、导出错
   - 缓解：编译器抽离为独立模块，单测覆盖
4. **Naive UI 体积**：~500KB gzip，首屏可能慢
   - 缓解：按需引入 + Vite tree-shaking
5. **MiMo TTS 数值化参数缺失**：无法做"0.8x/1.2x 滑块"（仅 MiMo）
   - 缓解：UI 标"语速：慢/正常/快"三档；同时提供 edge-tts 引擎供用户切换
6. **DeepSeek API 限速**：长文章（>3000 字）单次请求可能超时
   - 缓解：分段调用 / 流式输出 / 显示进度
7. **API Key 泄露风险**：后端 .env 文件若被推到 Git 会泄露
   - 缓解：`.gitignore` + 启动时校验；提供 `webframes init` 交互式生成 .env
8. **wav 时长解析**：MiMo 返回的 wav 可能头部不规范，duration 解析失败
   - 缓解：用 `music-metadata` 库解析；失败时降级为 `len(buffer) / 48000` 估算
9. **多段音频拼接漂移**：concat_segments.py 用 pydub 拼接时采样率不一致会漂移
   - 缓解：统一 24kHz/16bit/mono 输出；MiMo 默认就是 24kHz/16bit/mono
10. **MiMo 音色设计/复刻性能**：每次 TTS 都要重新传描述/音频，响应时间 2-5 秒
    - 缓解：缓存最近 5 分钟的 TTS 结果（按 text+voice 哈希 key）
11. **音色复刻音频样本存储**：用户上传的样本音频（≤10MB）存在 IndexedDB
    - 缓解：IndexedDB 配额够用；提供"清理未使用音色"按钮
12. **edge-tts 服务稳定性**：依赖微软在线服务，偶发不可用
    - 缓解：失败时回退到 MiMo；UI 显示"当前 edge-tts 不可用，建议切换到 MiMo"
13. **复刻样本全局共享的隐私问题**：浏览器内任何 JS（包括第三方扩展）可能读取 IndexedDB
    - 缓解：复刻样本不进导出包、加密存储可选（v0.2）；文档明确"本机敏感音频不要上传"
14. **AI 提议被全部拒绝**：用户可能 5 次都拒绝，浪费 DeepSeek token
    - 缓解：限制单次会话 AI 调用次数（每项目 10 次/小时）
15. **协同工作流的复杂度**：模式 3 的 UI 状态机比模式 1/2 单模式多一倍
    - 缓解：Pinia store 拆分子模块（useAiProposals / useAcceptedSegments），单测覆盖状态转换

---

## 13. 验收标准（v0.1+）

- [ ] 能从零跑通完整流程，导出 .zip
- [ ] 导出的 .zip 在本地用 `bash render.sh` 能成功生成 MP4
- [ ] 预览和导出的视频画面/字幕完全一致
- [ ] 5 段以内的简单视频，编排时间 < 10 分钟
- [ ] 关闭浏览器再打开，项目自动恢复（含音色库 + 自建音色样本）
- [ ] 主要浏览器（Chrome / Edge / Safari）兼容
- [ ] AI 智能分段：800 字文章 → 10 秒内返回分段结果
- [ ] TTS 试听：单段 < 5 秒拿到音频；10 段并发 < 30 秒全部完成
- [ ] 音色/语速/风格切换后能听出明显差异
- [ ] **TTS 引擎可切换**：项目设置切换 MiMo/edge 后，试听接口立即生效
- [ ] **MiMo 音色设计**：设计一个音色 → 试听 → 保存到音色库 → 段落选择该音色 → 试听成功
- [ ] **MiMo 音色复刻**：上传音频 → 试听 → 保存到音色库 → 段落选择该音色 → 试听成功
- [ ] **导出包双引擎**：导出时项目用 MiMo 引擎，渲染时改用 edge-tts 也能成功生成 MP4
- [ ] 后端未配置 Key 时，前端有清晰降级提示而非崩溃
- [ ] 导出包 .env.example 写清楚怎么填 MIMO_API_KEY / EDGE_TTS 配置（后者无需 key）
- [ ] 导出包内 tts.py 跑通后，narration.wav 时长与 timeline.json 完全一致
- [ ] **edge-tts 10 个中文子集**：打开音色库 → edge-tts 分类下默认展示 10 个推荐音色
- [ ] **edge-tts 数值化滑块**：选 edge-tts 引擎时，rate/volume/pitch 三个滑块可见；选 MiMo 时隐藏
- [ ] **复刻样本全局共享**：项目 A 复刻一个音色 → 切到项目 B → 音色库中能看到同一音色（含样本）
- [ ] **AI 提议+人工协同**：AI 分段后能逐段采纳/拒绝，已采纳段可编辑，新增段与 AI 段共存
- [ ] **AI 置信度展示**：低置信度段（<0.5）有红色标识

---

## 14. 参考资料

- [HyperFrames Skill 源码](C:/Users/Administrator/.workbuddy/skills/hyperframes-video/SKILL.md)
- [HyperFrames 模板](C:/Users/Administrator/.workbuddy/skills/hyperframes-video/assets/template/index.html)
- [GSAP 文档](https://gsap.com/docs/v3/)
- [Naive UI 文档](https://www.naiveui.com/)
- [Pinia 文档](https://pinia.vuejs.org/)
- [DeepSeek API 文档](https://api-docs.deepseek.com/zh-cn/)
- [小米 MiMo TTS v2.5 文档](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5)
- [edge-tts GitHub](https://github.com/rany2/edge-tts)

---

_本文档 v0.1.3 · 已整合 AI 提议+人工协同分段 + 复刻样本全局共享 + edge-tts 10 个中文子集锁定 + edge 数值化滑块 · 待评审 · 评审通过后进入开发阶段_
