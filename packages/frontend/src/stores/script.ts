/**
 * 文案输入 + 分段 + TTS store（Phase B + C）
 * 支持三模式分段：手动 / AI / AI+人工协同
 * 支持 TTS 试听：调用后端 /api/tts，播放音频，回填 actualDuration
 */
import { defineStore } from 'pinia';
import { ref, computed, reactive } from 'vue';
import type {
  ScriptSegment,
  SegmentRole,
  SegmentSource,
  SceneVisual,
  AISegmentProposal,
  TTSEngine,
  TtsSpeed,
  TtsStyle,
  TtsRequest,
} from '@webframes/shared-types';
import { useProjectStore } from './project';
import { useVoicesStore } from './voices';
import { synthTts } from '../api/tts';

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
    voiceId: engine === 'mimo' ? 'mimo-冰糖' : 'edge-Xiaoxiao',
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
    visual: opts.visual,
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

  // -------- TTS 状态 --------
  /** 正在合成的段 ID 集合 */
  const synthesizingIds = ref<Set<string>>(new Set());
  /** 正在播放的段 ID */
  const playingId = ref<string | null>(null);
  /** TTS 错误信息（段 ID → 错误信息） */
  const ttsErrors = ref<Map<string, string>>(new Map());

  // ============ Action ============

  /** 设置原始文案（支持 Markdown 转纯文本） */
  function setRawText(text: string) {
    const plain = text
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .replace(/\n{2,}/g, '\n\n')
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
    clearAiState();
  }

  /** 手动添加空段（在指定段之后） */
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

  /** 在指定段之前插入空段 */
  function insertSegmentBefore(id: string) {
    const idx = segments.value.findIndex(s => s.id === id);
    const insertAt = idx >= 0 ? idx : 0;
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
    if (playingId.value === id) stopPlayback();
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

  /** 合并两段 */
  function mergeSegments(sourceId: string, targetId: string) {
    const source = segments.value.find(s => s.id === sourceId);
    const target = segments.value.find(s => s.id === targetId);
    if (source && target && source.id !== target.id) {
      source.text = source.text + ' ' + target.text;
      source.source = 'manual';
      segments.value = segments.value.filter(s => s.id !== targetId);
      reindex();
    }
  }

  /** 在光标位置拆分段 */
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

  /** 更新段的 TTS 配置 */
  function updateSegmentTts(id: string, tts: Partial<ScriptSegment['tts']>) {
    const seg = segments.value.find(s => s.id === id);
    if (seg) {
      Object.assign(seg.tts, tts);
    }
  }

  // -------- AI 分段 --------

  function setAiProposals(proposals: AISegmentProposal[]) {
    aiProposals.value = proposals;
    adoptedIndexes.value = new Set();
    aiStatus.value = 'success';
    aiError.value = '';
  }

  function adoptProposal(proposalIdx: number) {
    if (adoptedIndexes.value.has(proposalIdx)) return;
    adoptedIndexes.value.add(proposalIdx);
    const p = aiProposals.value[proposalIdx];
    if (!p) return;
    const seg = createSegment(p.text, {
      role: p.role,
      confidence: p.confidence,
      source: 'ai',
      visual: p.visual,
    });
    const insertAt = adoptedIndexes.value.size - 1;
    segments.value.splice(insertAt, 0, seg);
    reindex();
  }

  function adoptAllProposals() {
    aiProposals.value.forEach((_, idx) => adoptProposal(idx));
  }

  function rejectProposal(proposalIdx: number) {
    adoptedIndexes.value.delete(proposalIdx);
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

  function rejectAllProposals() {
    segments.value = segments.value.filter(s => s.source !== 'ai');
    adoptedIndexes.value = new Set();
    reindex();
  }

  function clearAiState() {
    aiStatus.value = 'idle';
    aiError.value = '';
    aiProposals.value = [];
    adoptedIndexes.value = new Set();
  }

  function restoreOriginal() {
    segments.value = [];
    clearAiState();
  }

  /** 清空所有分段 */
  function clearSegments() {
    segments.value = [];
    activeSegmentId.value = null;
  }

  // -------- TTS 合成 --------

  /**
   * 对单段调用 TTS
   * 后端返回 audioUrl（data URL），前端存为 blob URL 填入 segment.audioUrl
   * 同时用 AudioContext 测量真实时长回填 segment.audioDuration
   */
  async function synthesizeSegment(segmentId: string): Promise<void> {
    const seg = segments.value.find(s => s.id === segmentId);
    if (!seg || !seg.text.trim()) {
      ttsErrors.value.set(segmentId, '段文案为空');
      return;
    }

    synthesizingIds.value = new Set([...synthesizingIds.value, segmentId]);
    ttsErrors.value.delete(segmentId);

    try {
      // 从音色库查找音色信息
      const voicesStore = useVoicesStore();
      const voice = voicesStore.findById(seg.tts.voiceId);

      const req: TtsRequest = {
        text: seg.text,
        voiceId: seg.tts.voiceId,
        engine: seg.tts.engine,
        speed: seg.tts.speed,
        voiceType: 'preset', // 默认预置，下方按实际类型覆盖
      };

      // 按音色类型补充字段
      if (voice?.kind === 'design') {
        req.voiceType = 'design';
        req.voiceDescription = voice.promptText;
      } else if (voice?.kind === 'clone') {
        req.voiceType = 'clone';
        // 从 IndexedDB 获取样本 base64
        const sampleBase64 = await voicesStore.getSampleBase64(voice.sampleAudioId);
        if (sampleBase64) {
          req.voiceSampleBase64 = sampleBase64;
        }
      }

      // apiPost 成功时直接返回 TtsResponse，失败时 throw
      const data = await synthTts(req);

      // 将 data URL 转为 blob URL 存储
      const blob = await (await fetch(data.audioUrl)).blob();
      const blobUrl = URL.createObjectURL(blob);

      seg.audioUrl = blobUrl;
      // 如果后端返回了时长就用，否则从 blob 测量
      if (data.duration > 0) {
        seg.audioDuration = data.duration;
      } else {
        measureDuration(blobUrl).then(d => { seg.audioDuration = d; });
      }
    } catch (err: any) {
      ttsErrors.value.set(segmentId, err.message || 'TTS 合成失败');
    } finally {
      const next = new Set(synthesizingIds.value);
      next.delete(segmentId);
      synthesizingIds.value = next;
    }
  }

  /** 测量音频真实时长 */
  function measureDuration(blobUrl: string): Promise<number> {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.addEventListener('loadedmetadata', () => {
        resolve(Math.round(audio.duration * 100) / 100);
      });
      audio.addEventListener('error', () => resolve(0));
      audio.src = blobUrl;
    });
  }

  /** 对所有段批量 TTS */
  async function synthesizeAll(): Promise<void> {
    const tasks = segments.value.map(s => synthesizeSegment(s.id));
    await Promise.all(tasks);
  }

  /** 播放段音频 */
  function playSegment(segmentId: string): void {
    const seg = segments.value.find(s => s.id === segmentId);
    if (!seg?.audioUrl) return;
    stopPlayback();
    const audio = new Audio(seg.audioUrl);
    audio.play();
    playingId.value = segmentId;
    audio.addEventListener('ended', () => {
      if (playingId.value === segmentId) playingId.value = null;
    });
  }

  /** 停止播放 */
  function stopPlayback(): void {
    // Audio 元素无法直接停止，但我们可以让 GC 回收
    playingId.value = null;
  }

  // -------- 同步到 project store --------

  function syncToProject() {
    const project = useProjectStore();
    project.updateSegments(segments.value);
  }

  function setSplitMode(mode: SplitMode) {
    splitMode.value = mode;
  }

  function setAiLoading() {
    aiStatus.value = 'loading';
    aiError.value = '';
  }

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
    synthesizingIds,
    playingId,
    ttsErrors,
    // actions
    setRawText,
    splitByNewline,
    addSegment,
    insertSegmentBefore,
    updateSegmentText,
    removeSegment,
    moveUp,
    moveDown,
    mergeSegments,
    splitSegment,
    reindex,
    updateSegmentTts,
    setAiProposals,
    adoptProposal,
    adoptAllProposals,
    rejectProposal,
    rejectAllProposals,
    clearAiState,
    restoreOriginal,
    clearSegments,
    synthesizeSegment,
    synthesizeAll,
    playSegment,
    stopPlayback,
    setSplitMode,
    setAiLoading,
    setAiError,
    syncToProject,
  };
});
