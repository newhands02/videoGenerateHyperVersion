# @webframes/shared-types

WebFrames 前后端共享 TypeScript 类型定义。

## 包含的核心类型

- `Project` / `Resolution` / `TTSEngine` / `ProjectMeta`
- `ScriptSegment` / `SegmentRole` / `SegmentTTSConfig` / `TtsSpeed` / `TtsStyle`
- `SceneConfig` / `SceneTemplateId` / `AnimationType`
- `VoiceEntry`（联合类型 `PresetVoice | DesignVoice | CloneVoice`）
- `VoiceSample`（复刻样本，独立于 VoiceEntry 全局共享）
- `AISegmentProposal` / `SplitScriptResponse`
- `TtsRequest` / `TtsResponse`
- `TimelineEntry`

## 使用方式

```ts
// frontend
import type { Project, ScriptSegment } from '@webframes/shared-types';

// backend
import type { ApiResponse, TtsRequest } from '@webframes/shared-types';
```

Phase A 阶段此包是源码导出（`main: src/index.ts`），无需构建。生产构建时再切换为 dist 产物。
