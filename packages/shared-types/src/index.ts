/**
 * WebFrames 核心类型定义
 * 前后端共享，所有数据结构都从这里导出
 */

// ==================== 项目核心 ====================

/**
 * 整个视频项目
 */
export interface Project {
  id: string;
  name: string;
  /** 创建时间（ISO 字符串） */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 视频分辨率 */
  resolution: Resolution;
  /** TTS 引擎全局选择 */
  ttsEngine: TTSEngine;
  /** 脚本段列表 */
  segments: ScriptSegment[];
  /** 场景列表（与 segments 长度一致，1:1 对应） */
  scenes: SceneConfig[];
  /** 项目级元数据 */
  meta: ProjectMeta;
}

export interface Resolution {
  width: number;
  height: number;
  label: '720p' | '1080p' | '4k';
}

export type TTSEngine = 'mimo' | 'edge';

export interface ProjectMeta {
  /** 主题色（Naive UI 主色） */
  themeColor: string;
  /** 字体（系统字体栈） */
  fontFamily: string;
  /** 视频总时长（秒），由 segments 推断出来 */
  totalDuration: number;
}

// ==================== 脚本段 ====================

/**
 * 单段脚本
 */
export interface ScriptSegment {
  id: string;
  /** 段顺序索引（0-based） */
  index: number;
  /** 段文案（纯文本，可含音频标签 [叹气] [气声] 等） */
  text: string;
  /** 叙事角色（AI 分段时识别） */
  role?: SegmentRole;
  /** AI 分段置信度（0-1） */
  confidence?: number;
  /** 来源 */
  source: SegmentSource;
  /** TTS 配置 */
  tts: SegmentTTSConfig;
  /** 真实音频时长（秒），试听后才有值 */
  audioDuration?: number;
  /** 音频 URL（blob: 或 path:） */
  audioUrl?: string;
}

export type SegmentRole =
  | 'hook'      // 钩子开场
  | 'pain'      // 痛点
  | 'turn'      // 转折
  | 'climax'    // 高潮
  | 'cta'       // 行动号召
  | 'transition'; // 过渡

export type SegmentSource = 'manual' | 'ai' | 'ai-edited';

/**
 * 单段 TTS 配置
 */
export interface SegmentTTSConfig {
  /** 音色条目 ID（音色库内的 voiceId） */
  voiceId: string;
  /** 引擎（覆盖项目级） */
  engine?: TTSEngine;
  /** 语速档位（MiMo 限定） */
  speed: TtsSpeed;
  /** 数值化语速（edge-tts 限定，-50 ~ +100 百分比） */
  rate?: number;
  /** 数值化音量（edge-tts 限定，-50 ~ +50） */
  volume?: number;
  /** 数值化音调（edge-tts 限定，-50 ~ +50 Hz） */
  pitch?: number;
  /** 风格描述（MiMo 限定，free text） */
  style: TtsStyle;
}

export type TtsSpeed = 'slow' | 'normal' | 'fast';

export type TtsStyle =
  | 'neutral'
  | 'passionate'
  | 'gentle'
  | 'serious'
  | 'sad'
  | 'excited';

// ==================== 场景 ====================

/**
 * 单段对应的场景配置
 */
export interface SceneConfig {
  id: string;
  /** 关联的段 ID */
  segmentId: string;
  /** 场景模板 ID */
  templateId: SceneTemplateId;
  /** 模板特定参数 */
  params: Record<string, string | number | boolean>;
  /** 入场动画 */
  enterAnimation: AnimationType;
  /** 退场动画 */
  exitAnimation: AnimationType;
  /** 持续时间（秒），缺省用 audioDuration */
  duration?: number;
}

export type SceneTemplateId =
  | 'pure-color-title'  // 纯色背景+大字标题
  | 'gradient-text'     // 渐变背景+居中文字
  | 'split-dialogue'    // 左右分屏对话
  | 'data-card';        // 数据卡片

export type AnimationType =
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'zoom-in'
  | 'zoom-out'
  | 'none';

// ==================== 音色库 ====================

/**
 * 统一音色条目（三种来源共用一个数据结构）
 */
export type VoiceEntry = PresetVoice | DesignVoice | CloneVoice;

interface VoiceEntryBase {
  id: string;
  /** 用户自定义别名（默认 = 预置 name） */
  alias: string;
  /** 引擎 */
  engine: TTSEngine;
  /** 适用语种 */
  lang: 'zh-CN' | 'zh-HK' | 'en-US' | 'multi';
  /** 性别 */
  gender?: 'female' | 'male' | 'neutral';
  /** 描述 */
  description?: string;
  /** 创建时间 */
  createdAt: string;
  /** 最后使用时间 */
  lastUsedAt?: string;
  /** 是否预置（预置不可删） */
  isPreset: boolean;
}

export interface PresetVoice extends VoiceEntryBase {
  kind: 'preset';
  /** 引擎原生 ID（MiMo: "冰糖"；edge: "zh-CN-XiaoxiaoNeural"） */
  nativeId: string;
}

export interface DesignVoice extends VoiceEntryBase {
  kind: 'design';
  /** 自然语言描述（MiMo design 模式必传） */
  promptText: string;
}

export interface CloneVoice extends VoiceEntryBase {
  kind: 'clone';
  /** 复刻样本音频 ID（指向 voice_samples 表） */
  sampleAudioId: string;
  /** 原文字幕（可选） */
  transcript?: string;
}

// ==================== 复刻样本（全局共享）====================

export interface VoiceSample {
  id: string;
  /** 关联的 CloneVoice id（冗余存一份方便查询） */
  voiceId: string;
  /** 音频 MIME（audio/wav / audio/mpeg） */
  mime: string;
  /** 原始字节大小 */
  bytes: number;
  /** 音频时长（秒） */
  duration: number;
  /** 创建时间 */
  createdAt: string;
  /** 音频二进制（IndexedDB 存储） */
  blob: Blob;
}

/** 分段模式（Step 2 三模式） */
export type SplitMode = 'manual' | 'ai' | 'collab';

// ==================== AI 协同分段 ====================

/**
 * AI 提议的单段（含置信度）
 */
export interface AISegmentProposal {
  text: string;
  role: SegmentRole;
  confidence: number;
  suggestedVoice: 'female-warm' | 'male-deep' | 'female-bright' | 'male-young';
  notes: string;
}

/**
 * AI 分段 API 返回
 */
export interface SplitScriptResponse {
  proposals: AISegmentProposal[];
  /** 模型用量 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  /** 原始模型输出（用于调试） */
  raw?: string;
}

// ==================== TTS API ====================

/**
 * TTS 请求（统一接口）
 */
export interface TtsRequest {
  text: string;
  /** 音色条目 ID（前端从音色库选） */
  voiceId: string;
  /** 可选覆盖引擎（不传则用 voiceId 对应引擎） */
  engine?: TTSEngine;
  /** 音色类型（后端分发用） */
  voiceType?: 'preset' | 'design' | 'clone';
  /** 音色描述（design 类型必传） */
  voiceDescription?: string;
  /** 样本音频 Base64（clone 类型必传，格式 data:audio/mpeg;base64,...） */
  voiceSampleBase64?: string;
  speed?: TtsSpeed;
  style?: TtsStyle;
  rate?: number;
  volume?: number;
  pitch?: number;
}

export interface TtsResponse {
  /** 音频 URL（blob: 或 http(s):） */
  audioUrl: string;
  /** 音频时长（秒，后端用 music-metadata 解析） */
  duration: number;
  /** MIME */
  mime: string;
  /** 引擎 */
  engine: TTSEngine;
  /** 音色 ID（回填） */
  voiceId: string;
}

// ==================== 通用 API 包装 ====================

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ==================== 时间轴 ====================

/**
 * 单段时间轴条目（与 segment 1:1 映射，存起始时间）
 */
export interface TimelineEntry {
  segmentId: string;
  /** 起始时间（秒） */
  start: number;
  /** 结束时间（秒） */
  end: number;
  /** 来源 segment 引用 */
  segment: ScriptSegment;
}
