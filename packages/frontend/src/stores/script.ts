/**
 * 文案输入 + 分段 store（Phase B）
 * 支持三模式分段：手动 / AI / AI+人工协同
 */
import { defineStore } from 'pinia';
import { ref, computed, reactive } from 'vue';
import type {
  ScriptSegment,
  SegmentRole,
  SegmentSource,
  AISegmentProposal,
  TTSEngine,
  TtsSpeed,
  TtsStyle,
} from '@webframes/shared-types';
import { useProjectStore } from './project';

/** 分段模式 */
export type SplitMode = 'manual' | 'ai' | 'collab';

/** AI 分段状态 */
export type AiSplitStatus = 'idle' | 'loading' | 'success' | 'error';

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 创建默认 TTS 配置 */
function defaultTts(engine: TTSEngine = 'mimo'): ScriptSegment['tts'] {
  return {
    voiceId: engine === 'mimo' ? 'mimo-preset-冰糖' : 'edge-zh-CN-XiaoxiaoNeural',
    engine,
    speed: 'normal' as TtsSpeed,
    style: 'neutral' as TtsStyle,
  };
}

/** 创建空分段 */
function createSegment(text: string, opts: Partial<ScriptSegment> = {}): ScriptSegment {
  return reactive({
    id: uid(),
    index: opts.index ?? 0,
    text,
    role: opts.role,
    confidence: opts.confidence,
    source: opts.source ?? 'manual',
    tts: opts.tts ?? defaultTts(),
    audioDuration: opts.audioDuration,
    audioUrl: opts.audioUrl,
  }) as ScriptSegment;
}

export const useScriptStore = defineStore('script', () => {
  // -------- 原始文案 --------
  const rawText = ref('');

  const wordCount = computed(() =>
    rawText.value.replace(/\s/g, '').length,
  );

  /** 估算时长（秒）：中文按 3.8 字/秒 */
  const estimatedDuration = computed(() => wordCount.value / 3.8);

  // -------- 分段列表 --------
  const segments = ref<ScriptSegment[]>([]);

  const segmentCount = computed(() => segments.value.length);

  const totalDuration = computed(() =>
    segments.value.reduce((sum, s) => sum + (s.audioDuration ?? Math.ceil(s.text.length / 3.8)), 0),
  );

  // -------- 分段模式 --------
  const splitMode = ref<SplitMode>('collab'); // 默认协同模式

  // -------- AI 分段 --------
  const aiStatus = ref<AiSplitStatus>('idle');
  const aiError = ref('');
  const aiProposals = ref<AISegmentProposal[]>([]);
  /** 已采纳的 proposal 索引 */
  const adoptedIndexes = ref<Set<number>>(new Set());

  // -------- 当前编辑中的分段 --------
  const activeSegmentId = ref<string | null>(null);

  // ============ Action ============

  /** 设置原始文案（支持 Markdown 转纯文本） */
  function setRawText(text: string) {
    // 去掉 Markdown 语法，保留纯文本
    const plain = text
      .replace(/^#{1,6}\s+/gm, '')   // 标题
      .replace(/\*\*(.+?)\*\*/g, '$1') // 加粗
      .replace(/\*(.+?)\*/g, '$1')     // 斜体
      .replace(/`(.+?)`/g, '$1')       // 行内代码
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // 链接
      .replace(/\n{2,}/g, '\n\n')       // 多余空行
      .trim();
    rawText.value = plain;
  }

  /** 从 rawText 按回车分段（手动模式） */
  function splitByNewline() {
    const lines = rawText.value.split('\n').filter(l => l.trim());
    if (lines.length === 0) return;
    segments.value = lines.map((text, i) =>
      createSegment(text, { index: i, source: 'manual' }),
    );
    // 清空 AI 状态
    clearAiState();
  }

  /** 手动添加空段 */
  function addSegment(afterId?: string) {
    const idx = afterId
      ? segments.value.findIndex(s => s.id === afterId)
      : segments.value.length - 1;
    const insertAt = idx >= 0 ? idx + 1 : segments.value.length;
    const newSeg = createSegment('', { index: insertAt, source: 'manual' });
    segments.value.splice(insertAt, 0, newSeg);
    reindex();
    activeSegmentId.value = newSeg.id;
  }

  /** 更新段文案 */
  function updateSegmentText(id: string, text: string) {
    const seg = segments.value.find(s => s.id === id);
    if (seg) {
      seg.text = text;
      if (seg.source === 'ai') seg.source = 'ai-edited';
    }
  }

  /** 删除段 */
  function removeSegment(id: string) {
    segments.value = segments.value.filter(s => s.id !== id);
    reindex();
    if (activeSegmentId.value === id) activeSegmentId.value = null;
  }

  /** 上移段 */
  function moveUp(id: string) {
    const idx = segments.value.findIndex(s => s.id === id);
    if (idx > 0) {
      const [seg] = segments.value.splice(idx, 1);
      segments.value.splice(idx - 1, 0, seg);
      reindex();
    }
  }

  /** 下移段 */
  function moveDown(id: string) {
    const idx = segments.value.findIndex(s => s.id === id);
    if (idx >= 0 && idx < segments.value.length - 1) {
      const [seg] = segments.value.splice(idx, 1);
      segments.value.splice(idx + 1, 0, seg);
      reindex();
    }
  }

  /** 合并两段（将 target 合并到 source，删除 target） */
  function mergeSegments(sourceId: string, targetId: string) {
    const source = segments.value.find(s => s.id === sourceId);
    const target = segments.value.find(s => s.id === targetId);
    if (source && target && source.id !== target.id) {
      source.text = source.text + ' ' + target.text;
      source.source = 'manual'; // 合并后视为手动
      segments.value = segments.value.filter(s => s.id !== targetId);
      reindex();
    }
  }

  /** 在光标位置拆分段（按回车触发） */
  function splitSegment(id: string, cursorPos: number) {
    const seg = segments.value.find(s => s.id === id);
    if (!seg) return;
    const before = seg.text.slice(0, cursorPos).trim();
    const after = seg.text.slice(cursorPos).trim();
    seg.text = before;
    const idx = segments.value.findIndex(s => s.id === id);
    const newSeg = createSegment(after, {
      index: idx + 1,
      source: seg.source === 'ai' ? 'ai-edited' : 'manual',
      role: seg.role,
    });
    segments.value.splice(idx + 1, 0, newSeg);
    reindex();
  }

  /** 重新计算 index */
  function reindex() {
    segments.value.forEach((s, i) => s.index = i);
  }

  // -------- AI 分段 --------

  /** 设置 AI 提议（来自 DeepSeek 返回） */
  function setAiProposals(proposals: AISegmentProposal[]) {
    aiProposals.value = proposals;
    adoptedIndexes.value = new Set();
    aiStatus.value = 'success';
    aiError.value = '';
  }

  /** 采纳单条 AI 提议 */
  function adoptProposal(proposalIdx: number) {
    if (adoptedIndexes.value.has(proposalIdx)) return;
    adoptedIndexes.value.add(proposalIdx);
    const p = aiProposals.value[proposalIdx];
    if (!p) return;
    const seg = createSegment(p.text, {
      role: p.role,
      confidence: p.confidence,
      source: 'ai',
    });
    // 插入到合适位置（按采纳顺序）
    const insertAt = adoptedIndexes.value.size - 1;
    segments.value.splice(insertAt, 0, seg);
    reindex();
  }

  /** 采纳所有 AI 提议 */
  function adoptAllProposals() {
    aiProposals.value.forEach((_, idx) => adoptProposal(idx));
  }

  /** 拒绝单条 AI 提议 */
  function rejectProposal(proposalIdx: number) {
    adoptedIndexes.value.delete(proposalIdx);
    // 如果该 proposal 已加入 segments，需要移除
    const p = aiProposals.value[proposalIdx];
    if (!p) return;
    const segIdx = segments.value.findIndex(
      s => s.source === 'ai' && s.text === p.text,
    );
    if (segIdx >= 0) {
      segments.value.splice(segIdx, 1);
      reindex();
    }
  }

  /** 拒绝所有 AI 提议（回到手动模式） */
  function rejectAllProposals() {
    // 移除所有 source=ai 的段
    segments.value = segments.value.filter(s => s.source !== 'ai');
    adoptedIndexes.value = new Set();
    reindex();
  }

  /** 清空 AI 状态 */
  function clearAiState() {
    aiStatus.value = 'idle';
    aiError.value = '';
    aiProposals.value = [];
    adoptedIndexes.value = new Set();
  }

  /** 恢复原文（segments 清空，回到 rawText） */
  function restoreOriginal() {
    segments.value = [];
    clearAiState();
  }

  // -------- 同步到 project store --------

  function syncToProject() {
    const project = useProjectStore();
    project.updateSegments(segments.value);
  }

  /** 设置分段模式 */
  function setSplitMode(mode: SplitMode) {
    splitMode.value = mode;
  }

  /** 设置 AI 加载状态 */
  function setAiLoading() {
    aiStatus.value = 'loading';
    aiError.value = '';
  }

  /** 设置 AI 错误 */
  function setAiError(msg: string) {
    aiStatus.value = 'error';
    aiError.value = msg;
  }

  return {
    // state
    rawText,
    wordCount,
    estimatedDuration,
    segments,
    segmentCount,
    totalDuration,
    splitMode,
    aiStatus,
    aiError,
    aiProposals,
    adoptedIndexes,
    activeSegmentId,
    // actions
    setRawText,
    splitByNewline,
    addSegment,
    updateSegmentText,
    removeSegment,
    moveUp,
    moveDown,
    mergeSegments,
    splitSegment,
    reindex,
    setAiProposals,
    adoptProposal,
    adoptAllProposals,
    rejectProposal,
    rejectAllProposals,
    clearAiState,
    restoreOriginal,
    setSplitMode,
    setAiLoading,
    setAiError,
    syncToProject,
  };
});
