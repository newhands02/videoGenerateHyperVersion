<script setup lang="ts">
import { ref, computed, onUnmounted, onMounted, watch } from 'vue';
import { useScriptStore } from '../stores/script';
import { useProjectStore } from '../stores/project';
import { useRouter } from 'vue-router';
import {
  NButton, NTag, NText, NSlider, NModal, NCard,
  NSpace, NList, NListItem, NAlert, NSpin,
  NDivider, NProgress, NRadioGroup, NRadio, useMessage,
} from 'naive-ui';
import { exportProject, downloadBlob } from '../lib/exporter';
import {
  exportVideo, downloadVideoBlob,
  estimateVideoDuration, countAudioSegments,
  type VideoExportResult,
} from '../lib/videoExporter';
import { useVoicesStore } from '../stores/voices';
import { splitScript } from '../api/split';
import type { ScriptSegment, SegmentRole, SceneVisual, AISegmentProposal } from '@webframes/shared-types';

const script = useScriptStore();
const project = useProjectStore();
const voices = useVoicesStore();
const router = useRouter();
const message = useMessage();

// -------- Phase E: 自动补全 visual --------
// 如果 segment 已有 visual 跳过，否则调用 AI 给所有段一起生成
const enrichingVisuals = ref(false);
const visualEnriched = ref(false);

async function enrichVisualsForExistingSegments() {
  if (enrichingVisuals.value) return;
  if (script.segments.length === 0) return;
  // 检查是否所有段都已有 visual
  const needEnrich = script.segments.filter(s => !s.visual || s.visual.mode === 'plain');
  if (needEnrich.length === 0) {
    visualEnriched.value = true;
    return;
  }
  enrichingVisuals.value = true;
  try {
    // 拼接所有段文本，让 LLM 一次性补全
    const combined = script.segments.map(s => s.text).join('\n');
    const result = await splitScript(combined);
    // 按数量对应回 segments（按 text 前缀匹配）
    const proposalByPrefix = new Map<string, AISegmentProposal>();
    result.proposals.forEach(p => {
      proposalByPrefix.set(p.text.slice(0, 12), p);
    });
    let matched = 0;
    script.segments.forEach(seg => {
      if (seg.visual && seg.visual.mode !== 'plain') return;
      const key = seg.text.slice(0, 12);
      const p = proposalByPrefix.get(key);
      if (p && p.visual) {
        seg.visual = p.visual;
        matched++;
      } else {
        // 兜底：用本地启发式生成最简 visual
        seg.visual = inferVisualFromText(seg.text, seg.role);
      }
    });
    visualEnriched.value = true;
    message.success(`已为 ${matched} 段生成场景画面`);
  } catch (err: any) {
    message.warning('AI 补全场景画面失败，使用本地推断');
    script.segments.forEach(seg => {
      if (!seg.visual || seg.visual.mode === 'plain') {
        seg.visual = inferVisualFromText(seg.text, seg.role);
      }
    });
  } finally {
    enrichingVisuals.value = false;
  }
}

/** 本地启发式：根据文本和角色推断 visual，不依赖 LLM */
function inferVisualFromText(text: string, role?: SegmentRole): SceneVisual {
  const t = text.trim();
  // 数字 + 人物 / 年代 → era-card
  const yearMatch = t.match(/(\d{2,4})\s*年/);
  if (yearMatch) {
    return {
      mode: 'era-card',
      palette: 'indigo',
      era: { year: yearMatch[1], subtitle: t.slice(0, 18).replace(yearMatch[0], '').trim() || role || '' },
      caption: t.slice(-30),
    };
  }
  // 含 "vs" / "比" / "PK" / "对" → versus
  if (/(.+?)\s*(vs\.?|对比|PK|对话|比较|还是)\s*(.+)/i.test(t)) {
    const m = t.match(/(.+?)\s*(vs\.?|对比|PK|对话|比较|还是)\s*(.+)/i);
    if (m) {
      return {
        mode: 'versus',
        palette: 'ocean',
        versus: { left: { label: m[1].trim().slice(0, 6), tone: 'warm' }, right: { label: m[3].trim().slice(0, 6), tone: 'cool' }, center: m[2] },
        caption: t.slice(-30),
      };
    }
  }
  // 含冒号解释 / "是" / "叫做" → formula
  if (/(什么是|叫做|意味着|等于|:|：)/.test(t)) {
    return {
      mode: 'formula',
      palette: 'amber',
      formula: { title: t.split(/[:：]/)[0].trim().slice(0, 8) || '概念', expression: t.split(/[:：]/)[1]?.trim().slice(0, 20) || t.slice(0, 20) },
      caption: t.slice(-30),
    };
  }
  // hook/climax 高优先级段 → quote
  if (role === 'hook' || role === 'climax') {
    return {
      mode: 'quote',
      palette: 'violet',
      quote: { text: t, author: role === 'hook' ? '钩子' : '高潮' },
      caption: t.slice(-30),
    };
  }
  // 默认 plain
  return {
    mode: 'plain',
    palette: 'indigo',
    caption: t.slice(-30),
  };
}

onMounted(() => {
  enrichVisualsForExistingSegments();
});

// -------- 导出状态 --------
const showExportDialog = ref(false);
const exporting = ref(false);
const exportResult = ref<{ filename: string; fileCount: number } | null>(null);

// -------- 视频导出状态 --------
const showVideoExportDialog = ref(false);
const videoExporting = ref(false);
const videoExportProgress = ref(0);
const videoExportPhase = ref('');
const videoExportResult = ref<VideoExportResult | null>(null);
const videoAnimationStyle = ref<'cinematic' | 'minimal' | 'static'>('cinematic');
const videoEstDuration = computed(() => estimateVideoDuration(script.segments));
const videoAudioCount = computed(() => countAudioSegments(script.segments));

// -------- 时间轴状态 --------
const pxPerSecond = ref(4);
const totalDuration = computed(() => script.totalDuration);
const scaledWidth = computed(() => totalDuration.value * pxPerSecond.value + 120);

const playheadSec = ref(0);
const isPlaying = ref(false);
const currentSegIndex = ref(-1);
let currentAudio: HTMLAudioElement | null = null;
let playRAF: number | null = null;
let noAudioTimer: number | null = null;

const draggingSegId = ref<string | null>(null);
const dragStartX = ref(0);
const dragOrigStart = ref(0);

// -------- 分段时间计算 --------
const segmentTimes = computed(() => {
  let t = 0;
  return script.segments.map(seg => {
    const dur = seg.audioDuration ?? Math.ceil(seg.text.length / 3.8);
    const start = t;
    t += dur;
    return { start, end: start + dur, duration: dur };
  });
});

function segStyle(seg: ScriptSegment) {
  const times = segmentTimes.value[seg.index];
  const start = times ? times.start : 0;
  const left = 60 + start * pxPerSecond.value;
  const width = Math.max((seg.audioDuration ?? Math.ceil(seg.text.length / 3.8)) * pxPerSecond.value, 40);
  return { left, width, start };
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const ticks = computed(() => {
  const result: number[] = [];
  const step = totalDuration.value > 120 ? 10 : totalDuration.value > 60 ? 5 : 1;
  for (let t = 0; t <= totalDuration.value; t += step) {
    result.push(t);
  }
  return result;
});

// -------- 场景预览 --------
const sceneBackgrounds: Record<string, string> = {
  hook: 'linear-gradient(135deg, #0f0c29, #302b63)',
  pain: 'linear-gradient(135deg, #232526, #414345)',
  turn: 'linear-gradient(135deg, #1a2a6c, #b21f1f)',
  climax: 'linear-gradient(135deg, #f12711, #f5af19)',
  cta: 'linear-gradient(135deg, #134e5e, #71b280)',
  transition: 'linear-gradient(135deg, #2c3e50, #3498db)',
};

const paletteBackgrounds: Record<string, string> = {
  indigo:  'linear-gradient(135deg, #0f0c29, #302b63)',
  ember:   'linear-gradient(135deg, #1c1c1c, #3a3a3a)',
  ocean:   'linear-gradient(135deg, #1a2a6c, #0d4f5c)',
  forest:  'linear-gradient(135deg, #134e5e, #71b280)',
  violet:  'linear-gradient(135deg, #2c1810, #6b2d5c)',
  amber:   'linear-gradient(135deg, #f12711, #f5af19)',
};

function sceneBg(seg: ScriptSegment | null): string {
  if (!seg) return 'linear-gradient(135deg, #1a1a2e, #16213e)';
  // Phase E: 优先使用 visual.palette
  if (seg.visual?.palette && paletteBackgrounds[seg.visual.palette]) {
    return paletteBackgrounds[seg.visual.palette];
  }
  return sceneBackgrounds[seg.role ?? ''] ?? 'linear-gradient(135deg, #1a1a2e, #16213e)';
}

/** 当前预览场景（根据播放位置或播放头位置） */
const currentScene = computed<ScriptSegment | null>(() => {
  if (currentSegIndex.value >= 0 && currentSegIndex.value < script.segments.length) {
    return script.segments[currentSegIndex.value];
  }
  // 根据 playhead 位置确定
  for (let i = 0; i < segmentTimes.value.length; i++) {
    if (playheadSec.value < segmentTimes.value[i].end) {
      return script.segments[i];
    }
  }
  return script.segments[script.segments.length - 1] ?? null;
});

// -------- 拖拽 --------
function onDragStart(e: MouseEvent, segId: string) {
  e.preventDefault();
  draggingSegId.value = segId;
  dragStartX.value = e.clientX;
  const seg = script.segments.find(s => s.id === segId);
  dragOrigStart.value = seg ? seg.index : 0;
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e: MouseEvent) {
  if (!draggingSegId.value) return;
  const dx = e.clientX - dragStartX.value;
  const seg = script.segments.find(s => s.id === draggingSegId.value);
  if (!seg) return;
  const newIndex = Math.max(0, Math.min(
    script.segments.length - 1,
    dragOrigStart.value + Math.round(dx / 80),
  ));
  if (newIndex !== seg.index) {
    const fromIdx = seg.index;
    script.segments.splice(fromIdx, 1);
    script.segments.splice(newIndex, 0, seg);
    script.segments.forEach((s, i) => s.index = i);
    dragOrigStart.value = newIndex;
  }
}

function onDragEnd() {
  draggingSegId.value = null;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
}

// -------- 播放（带音频） --------
function togglePlay() {
  if (isPlaying.value) stopPlay();
  else startPlay();
}

function startPlay() {
  if (isPlaying.value) return;
  if (script.segments.length === 0) {
    message.warning('没有分段可播放');
    return;
  }

  isPlaying.value = true;

  // 如果播放头在末尾，重置到开头
  if (playheadSec.value >= totalDuration.value - 0.1) {
    playheadSec.value = 0;
  }

  // 找到当前播放头所在的分段
  let startIdx = 0;
  for (let i = 0; i < segmentTimes.value.length; i++) {
    if (playheadSec.value < segmentTimes.value[i].end) {
      startIdx = i;
      break;
    }
  }

  playSegmentSequence(startIdx);
}

function playSegmentSequence(idx: number) {
  if (!isPlaying.value || idx >= script.segments.length) {
    stopPlay();
    playheadSec.value = totalDuration.value;
    return;
  }

  // 清理上一个音频
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (noAudioTimer) {
    clearTimeout(noAudioTimer);
    noAudioTimer = null;
  }
  if (playRAF) {
    cancelAnimationFrame(playRAF);
    playRAF = null;
  }

  const seg = script.segments[idx];
  const times = segmentTimes.value[idx];
  currentSegIndex.value = idx;

  // 计算段内偏移
  const offset = Math.max(0, playheadSec.value - times.start);

  if (seg.audioUrl) {
    // 有音频：播放音频，用 currentTime 驱动 playhead
    currentAudio = new Audio(seg.audioUrl);
    if (offset > 0) {
      try { currentAudio.currentTime = Math.min(offset, times.duration); } catch {}
    }

    currentAudio.addEventListener('ended', () => {
      if (idx + 1 < script.segments.length) {
        playheadSec.value = segmentTimes.value[idx + 1].start;
        playSegmentSequence(idx + 1);
      } else {
        stopPlay();
        playheadSec.value = totalDuration.value;
      }
    });

    currentAudio.play().catch(() => {
      // 播放失败，用估算时长推进
      const remaining = Math.max(0.5, (times.duration - offset)) * 1000;
      noAudioTimer = window.setTimeout(() => {
        if (idx + 1 < script.segments.length) {
          playheadSec.value = segmentTimes.value[idx + 1].start;
          playSegmentSequence(idx + 1);
        } else {
          stopPlay();
        }
      }, remaining);
    });

    // 用 requestAnimationFrame 同步 playhead
    const updatePlayhead = () => {
      if (!isPlaying.value || !currentAudio) return;
      playheadSec.value = times.start + currentAudio.currentTime;
      playRAF = requestAnimationFrame(updatePlayhead);
    };
    playRAF = requestAnimationFrame(updatePlayhead);
  } else {
    // 无音频：用计时器模拟
    const remaining = Math.max(0.5, (times.duration - offset)) * 1000;
    const startTime = Date.now();
    const startPlayhead = times.start + offset;

    const updatePlayhead = () => {
      if (!isPlaying.value) return;
      const elapsed = (Date.now() - startTime) / 1000;
      playheadSec.value = Math.min(startPlayhead + elapsed, times.end);
      if (playheadSec.value < times.end) {
        playRAF = requestAnimationFrame(updatePlayhead);
      }
    };
    playRAF = requestAnimationFrame(updatePlayhead);

    noAudioTimer = window.setTimeout(() => {
      if (idx + 1 < script.segments.length) {
        playheadSec.value = segmentTimes.value[idx + 1].start;
        playSegmentSequence(idx + 1);
      } else {
        stopPlay();
        playheadSec.value = totalDuration.value;
      }
    }, remaining);
  }
}

function stopPlay() {
  isPlaying.value = false;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (noAudioTimer) {
    clearTimeout(noAudioTimer);
    noAudioTimer = null;
  }
  if (playRAF) {
    cancelAnimationFrame(playRAF);
    playRAF = null;
  }
  currentSegIndex.value = -1;
}

function onRulerClick(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x = e.clientX - rect.left - 60;
  const sec = x / pxPerSecond.value;
  if (sec >= 0 && sec <= totalDuration.value) {
    playheadSec.value = Math.round(sec * 10) / 10;
    if (isPlaying.value) {
      // 重新从新位置开始播放
      startPlay();
    }
  }
}

// -------- 单段试听 --------
function previewSegment(segId: string) {
  const seg = script.segments.find(s => s.id === segId);
  if (!seg?.audioUrl) {
    message.warning('该段尚未合成音频');
    return;
  }
  stopPlay();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  const idx = script.segments.findIndex(s => s.id === segId);
  currentSegIndex.value = idx;
  currentAudio = new Audio(seg.audioUrl);
  currentAudio.addEventListener('ended', () => {
    currentSegIndex.value = -1;
  });
  currentAudio.play();
}

// -------- 导出 --------
async function handleExport() {
  showExportDialog.value = true;
  exporting.value = true;
  exportResult.value = null;
  try {
    script.syncToProject();
    const proj = project.project;
    const segs = script.segments;

    const result = await exportProject(proj, segs, voices.entries);
    downloadBlob(result.blob, result.filename);
    exportResult.value = { filename: result.filename, fileCount: result.fileCount };
    message.success(`已下载 ${result.filename}`);
  } catch (err: any) {
    message.error(err.message || '导出失败');
  } finally {
    exporting.value = false;
  }
}

// -------- 直接导出视频 --------
function handleExportVideo() {
  if (script.segments.length === 0) {
    message.warning('没有分段可导出');
    return;
  }

  // 检查音频
  if (videoAudioCount.value === 0) {
    message.warning('所有分段都没有音频，导出的视频将没有声音。请先在 Step 3 合成 TTS。');
  }

  // 打开对话框（设置阶段）
  showVideoExportDialog.value = true;
  videoExporting.value = false;
  videoExportResult.value = null;
  videoExportProgress.value = 0;
  videoExportPhase.value = '';
}

async function startVideoExport() {
  videoExporting.value = true;
  videoExportResult.value = null;
  videoExportProgress.value = 0;
  videoExportPhase.value = '准备中...';

  try {
    script.syncToProject();
    const result = await exportVideo({
      project: project.project,
      segments: script.segments,
      animationStyle: videoAnimationStyle.value,
      onProgress: (current, total, phase) => {
        videoExportProgress.value = total > 0 ? Math.round((current / total) * 100) : 0;
        videoExportPhase.value = phase;
      },
    });

    downloadVideoBlob(result.blob, result.filename);
    videoExportResult.value = result;
    message.success(`视频已导出：${result.filename}`);
  } catch (err: any) {
    message.error(err.message || '视频导出失败');
    showVideoExportDialog.value = false;
  } finally {
    videoExporting.value = false;
  }
}

function closeVideoExportDialog() {
  showVideoExportDialog.value = false;
}

// 清理
onUnmounted(() => {
  stopPlay();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
});

// 键盘空格控制
function onKeydown(e: KeyboardEvent) {
  if (e.code === 'Space' && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    togglePlay();
  }
}

// 全局键盘监听
watch(() => true, () => {}, { immediate: true });
window.addEventListener('keydown', onKeydown);
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="step-container">
    <h2>Step 4 · 时间轴编排 & 预览</h2>
    <p class="desc">
      拖拽段块调整顺序，点击播放预览视频效果。总时长：{{ fmt(totalDuration) }}。
    </p>

    <!-- ===== 视频预览面板 ===== -->
    <div class="preview-panel" :style="{ background: sceneBg(currentScene) }">
      <!-- 调试条：显示当前段的 visual.mode（生产环境可去掉） -->
      <div v-if="currentScene" class="preview-debug-bar">
        <NTag size="tiny" :bordered="false" type="warning">
          {{ currentScene.role ?? 'no-role' }}
        </NTag>
        <NTag size="tiny" :bordered="false" :type="currentScene.visual ? 'success' : 'error'">
          🎬 {{ currentScene.visual?.mode ?? 'NO VISUAL' }}
        </NTag>
        <NTag v-if="currentScene.visual?.palette" size="tiny" :bordered="false" type="info">
          {{ currentScene.visual.palette }}
        </NTag>
      </div>

      <div class="preview-content">
        <!-- Phase E: 根据 visual.mode 显示不同场景画面 -->
        <template v-if="currentScene?.visual && currentScene.visual.mode !== 'plain'">
          <!-- era-card: 年代卡片 -->
          <div v-if="currentScene.visual.mode === 'era-card'" class="scene-era-card">
            <div class="era-year">{{ currentScene.visual.era?.year }}</div>
            <div class="era-divider"></div>
            <div class="era-subtitle">{{ currentScene.visual.era?.subtitle }}</div>
          </div>

          <!-- versus: 左右对照 -->
          <div v-else-if="currentScene.visual.mode === 'versus'" class="scene-versus">
            <div class="versus-side" :class="{ warm: currentScene.visual.versus?.left.tone === 'warm' }">
              {{ currentScene.visual.versus?.left.label }}
            </div>
            <div class="versus-center">{{ currentScene.visual.versus?.center ?? 'vs' }}</div>
            <div class="versus-side" :class="{ warm: currentScene.visual.versus?.right.tone === 'warm' }">
              {{ currentScene.visual.versus?.right.label }}
            </div>
          </div>

          <!-- formula: 概念卡片 -->
          <div v-else-if="currentScene.visual.mode === 'formula'" class="scene-formula">
            <div class="formula-title">{{ currentScene.visual.formula?.title }}</div>
            <div v-if="currentScene.visual.formula?.expression" class="formula-expr">
              {{ currentScene.visual.formula.expression }}
            </div>
          </div>

          <!-- quote: 引文卡片 -->
          <div v-else-if="currentScene.visual.mode === 'quote'" class="scene-quote">
            <div class="quote-mark">&ldquo;</div>
            <div class="quote-text">{{ currentScene.text }}</div>
            <div v-if="currentScene.visual.quote?.author" class="quote-author">
              &mdash; {{ currentScene.visual.quote.author }}
              <span v-if="currentScene.visual.quote.source"> · {{ currentScene.visual.quote.source }}</span>
            </div>
          </div>

          <!-- timeline-marker: 时间线节点 -->
          <div v-else-if="currentScene.visual.mode === 'timeline-marker'" class="scene-timeline">
            <div class="timeline-dot"></div>
            <div class="timeline-info">
              <div class="timeline-year">{{ currentScene.visual.era?.year }}</div>
              <div class="timeline-sub">{{ currentScene.visual.era?.subtitle }}</div>
            </div>
          </div>
        </template>

        <!-- 默认：纯文字 -->
        <div v-else class="preview-scene-text" v-if="currentScene">
          {{ currentScene.text }}
        </div>
        <div class="preview-scene-text placeholder" v-if="!currentScene">
          点击下方播放按钮预览视频
        </div>
      </div>

      <!-- 底部 caption（visual.caption） -->
      <div class="preview-caption" v-if="currentScene?.visual?.caption">
        {{ currentScene.visual.caption }}
      </div>

      <!-- 字幕条 -->
      <div class="preview-subtitle" v-if="currentScene">
        {{ currentScene.text }}
      </div>

      <!-- 段标记 -->
      <div class="preview-badge" v-if="currentScene">
        <NTag size="tiny" :bordered="false" type="info">
          段 {{ currentSegIndex >= 0 ? currentSegIndex + 1 : '?' }}
          <template v-if="currentScene.visual?.mode">
            · {{ currentScene.visual.mode }}
          </template>
        </NTag>
      </div>

      <!-- 播放控制 -->
      <div class="preview-controls">
        <NButton circle size="large" @click="togglePlay" :type="isPlaying ? 'error' : 'primary'">
          {{ isPlaying ? '⏸' : '▶' }}
        </NButton>
        <NText style="color: #fff; font-size: 13px; font-family: monospace; margin-left: 8px;">
          {{ fmt(playheadSec) }} / {{ fmt(totalDuration) }}
        </NText>
      </div>
    </div>

    <!-- ===== 工具栏 ===== -->
    <div class="toolbar">
      <NButton size="small" @click="togglePlay">
        {{ isPlaying ? '⏸ 暂停' : '▶ 播放' }}
      </NButton>
      <NButton
        size="small"
        :loading="enrichingVisuals"
        :disabled="script.segments.length === 0"
        @click="enrichVisualsForExistingSegments"
        style="margin-left: 8px"
      >
        🎨 {{ visualEnriched ? '重新生成视觉' : 'AI 生成场景画面' }}
      </NButton>
      <NText depth="3" style="margin-left: 12px; font-size: 13px;">
        播放头：{{ fmt(playheadSec) }}
      </NText>
      <div style="flex: 1;" />
      <NSlider
        :value="pxPerSecond"
        :min="2"
        :max="10"
        :step="1"
        style="width: 160px"
        @update:value="(val: number) => pxPerSecond = val"
      />
      <NText depth="3" style="font-size: 12px; margin-left: 8px;">缩放</NText>
    </div>

    <!-- ===== 时间轴 SVG ===== -->
    <div class="timeline-wrap">
      <svg :width="scaledWidth" height="120" style="overflow: visible;">
        <!-- 标尺 -->
        <g @click="onRulerClick" style="cursor: pointer;">
          <line x1="60" :x2="60 + totalDuration * pxPerSecond" y1="20" y2="20" stroke="#999" stroke-width="1" />
          <text x="10" y="24" font-size="11" fill="#999">时间</text>
          <g v-for="t in ticks" :key="t">
            <line
              :x1="60 + t * pxPerSecond"
              :x2="60 + t * pxPerSecond"
              y1="14"
              y2="26"
              stroke="#ccc"
              stroke-width="1"
            />
            <text
              :x="60 + t * pxPerSecond"
              y="36"
              font-size="10"
              fill="#999"
              text-anchor="middle"
            >{{ fmt(t) }}</text>
          </g>
        </g>

        <!-- 播放头 -->
        <line
          :x1="60 + playheadSec * pxPerSecond"
          :x2="60 + playheadSec * pxPerSecond"
          y1="0"
          y2="110"
          stroke="#18a058"
          stroke-width="2"
          stroke-dasharray="4"
        />

        <!-- 段块 -->
        <g v-for="seg in script.segments" :key="seg.id">
          <rect
            :x="segStyle(seg).left"
            y="45"
            :width="segStyle(seg).width"
            height="50"
            :fill="seg.role === 'hook' ? '#ff6b6b' : seg.role === 'cta' ? '#51cf66' : '#4dabf7'"
            rx="6"
            :opacity="currentSegIndex === seg.index ? 1 : 0.7"
            :stroke="currentSegIndex === seg.index ? '#fff' : 'transparent'"
            stroke-width="2"
            style="cursor: grab;"
            @mousedown="(e: MouseEvent) => onDragStart(e, seg.id)"
            @dblclick="previewSegment(seg.id)"
          />
          <text
            :x="segStyle(seg).left + 6"
            y="68"
            font-size="11"
            fill="#fff"
            pointer-events="none"
          >{{ `段${seg.index + 1}` }}</text>
          <text
            :x="segStyle(seg).left + 6"
            y="82"
            font-size="10"
            fill="rgba(255,255,255,0.8)"
            pointer-events="none"
          >{{ seg.audioDuration ? fmt(seg.audioDuration) : '?' }}</text>
        </g>
      </svg>
    </div>

    <!-- ===== 段列表 ===== -->
    <div class="seg-detail-list">
      <div v-for="seg in script.segments" :key="seg.id" class="seg-detail" :class="{ active: currentSegIndex === seg.index }">
        <NTag size="tiny" :type="seg.role === 'hook' ? 'error' : seg.role === 'cta' ? 'success' : 'default'">
          段 {{ seg.index + 1 }}
        </NTag>
        <NText style="font-size: 13px; flex: 1; margin-left: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          {{ seg.text.slice(0, 50) }}{{ seg.text.length > 50 ? '...' : '' }}
        </NText>
        <NText depth="3" style="font-size: 12px;">{{ seg.audioDuration ? fmt(seg.audioDuration) : '未合成' }}</NText>
        <NButton v-if="seg.audioUrl" text size="tiny" @click="previewSegment(seg.id)" style="margin-left: 8px;">试听</NButton>
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="bottom-bar">
      <NButton @click="router.push('/step/3')">← 返回 TTS</NButton>
      <NSpace>
        <NButton type="warning" @click="handleExport" :loading="exporting">
          📦 导出项目包
        </NButton>
        <NButton type="error" @click="handleExportVideo" :loading="videoExporting" :disabled="exporting">
          🎬 导出视频
        </NButton>
      </NSpace>
    </div>

    <!-- 导出对话框 -->
    <NModal :show="showExportDialog" @update:show="showExportDialog = $event" :mask-closable="false" style="width: 500px;">
      <NCard title="导出 HyperFrames 项目包" :bordered="false">
        <NSpin v-if="exporting" size="medium">
          <div style="height: 80px; display: flex; align-items: center; justify-content: center;">
            <NText depth="3">正在编译项目文件...</NText>
          </div>
        </NSpin>

        <div v-else-if="exportResult">
          <NAlert type="success" :bordered="false" style="margin-bottom: 12px;">
            导出成功！{{ exportResult.fileCount }} 个文件已打包下载。
          </NAlert>
          <NText depth="3" style="font-size: 13px;">
            文件名：{{ exportResult.filename }}
          </NText>

          <NDivider style="margin: 12px 0;" />
          <NText strong style="display: block; margin-bottom: 8px;">接下来要做的事：</NText>
          <NList bordered size="small">
            <NListItem>1. 解压 .zip 文件</NListItem>
            <NListItem>2. cd 到解压目录</NListItem>
            <NListItem>3. pip install edge-tts openai（如需 TTS）</NListItem>
            <NListItem>4. cp .env.example .env，填入 MIMO_API_KEY（如用 MiMo）</NListItem>
            <NListItem>5. bash render.sh（已合成音频会自动拼接）</NListItem>
            <NListItem>6. 等待完成，renders/ 目录下就是你的视频</NListItem>
          </NList>
        </div>

        <template #footer>
          <NSpace justify="end">
            <NButton @click="showExportDialog = false">关闭</NButton>
          </NSpace>
        </template>
      </NCard>
    </NModal>

    <!-- 视频导出对话框 -->
    <NModal :show="showVideoExportDialog" :mask-closable="false" style="width: 500px;">
      <NCard :title="videoExportResult ? '视频导出完成' : (videoExporting ? '正在导出视频' : '导出视频设置')" :bordered="false">
        <!-- 准备阶段（未开始） -->
        <div v-if="!videoExporting && !videoExportResult" style="padding: 8px 0;">
          <NText style="display: block; margin-bottom: 8px;">选择动画风格：</NText>
          <NRadioGroup v-model:value="videoAnimationStyle" style="width: 100%;">
            <NSpace vertical size="small">
              <NRadio value="cinematic">
                <NText strong>🎬 电影感（推荐）</NText>
                <br />
                <NText depth="3" style="font-size: 12px;">逐字飞入动画（不同方向+旋转+缩放） + 持续呼吸缩放 + 动态渐变背景（漂移光斑） + 角色装饰（星光/雨滴/光线/箭头） + 字幕逐字显现 + 段间过渡光效</NText>
              </NRadio>
              <NRadio value="minimal">
                <NText strong>✨ 轻度动效</NText>
                <br />
                <NText depth="3" style="font-size: 12px;">整段文字平滑淡入淡出 + 渐变背景（无装饰元素，无逐字动画）</NText>
              </NRadio>
              <NRadio value="static">
                <NText strong>📊 静态</NText>
                <br />
                <NText depth="3" style="font-size: 12px;">无动效，纯渐变 + 文字（适合需要二次剪辑的用户）</NText>
              </NRadio>
            </NSpace>
          </NRadioGroup>
          <NAlert type="info" :bordered="false" style="margin-top: 16px;">
            预计时长 {{ fmt(videoEstDuration) }}（实时录制 = 视频时长）<br />
            音频覆盖：{{ videoAudioCount }} / {{ script.segmentCount }} 段
          </NAlert>
        </div>

        <!-- 导出中 -->
        <div v-else-if="videoExporting" style="padding: 12px 0;">
          <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
            <NSpin size="large" />
          </div>
          <NText style="display: block; text-align: center; margin-bottom: 16px;">
            {{ videoExportPhase }}
          </NText>
          <NProgress
            type="line"
            :percentage="videoExportProgress"
            :show-indicator="true"
            :height="12"
          />
          <NAlert type="warning" :bordered="false" style="margin-top: 16px;">
            ⚠️ 请保持此标签页在前台，切换标签页会导致录制中断！
          </NAlert>
          <NText depth="3" style="font-size: 12px; display: block; text-align: center; margin-top: 10px;">
            预计时长 {{ fmt(videoEstDuration) }}（实时录制，{{ videoAudioCount }}/{{ script.segmentCount }} 段有音频）
          </NText>
        </div>

        <!-- 导出完成 -->
        <div v-else-if="videoExportResult">
          <NAlert type="success" :bordered="false" style="margin-bottom: 12px;">
            ✅ 视频已生成并开始下载！
          </NAlert>
          <NList bordered size="small">
            <NListItem>
              <NText depth="3" style="width: 80px;">文件名</NText>
              <NText>{{ videoExportResult.filename }}</NText>
            </NListItem>
            <NListItem>
              <NText depth="3" style="width: 80px;">格式</NText>
              <NText>{{ videoExportResult.ext.toUpperCase() }}</NText>
            </NListItem>
            <NListItem>
              <NText depth="3" style="width: 80px;">时长</NText>
              <NText>{{ fmt(videoExportResult.duration) }}</NText>
            </NListItem>
            <NListItem>
              <NText depth="3" style="width: 80px;">大小</NText>
              <NText>{{ (videoExportResult.blob.size / 1024 / 1024).toFixed(1) }} MB</NText>
            </NListItem>
          </NList>
          <NText depth="3" style="font-size: 12px; display: block; margin-top: 10px;">
            如未自动下载，请检查浏览器下载设置。视频文件已保存在内存中。
          </NText>
        </div>

        <template #footer>
          <NSpace justify="end">
            <NButton v-if="!videoExporting && !videoExportResult" @click="closeVideoExportDialog">取消</NButton>
            <NButton v-if="!videoExporting && !videoExportResult" type="primary" @click="startVideoExport">
              开始导出
            </NButton>
            <NButton v-else @click="closeVideoExportDialog">关闭</NButton>
          </NSpace>
        </template>
      </NCard>
    </NModal>
  </div>
</template>

<style scoped>
.step-container {
  max-width: 100%;
  padding: 24px;
  overflow-x: auto;
}
.desc {
  color: #666;
  margin-bottom: 16px;
}

/* ===== 预览面板 ===== */
.preview-panel {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 16px;
  background: linear-gradient(135deg, #1a1a2e, #16213e);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.preview-content {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 60px;
}

.preview-scene-text {
  font-size: 28px;
  color: #fff;
  text-align: center;
  line-height: 1.6;
  max-width: 1200px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  word-break: break-word;
}

.preview-scene-text.placeholder {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.4);
}

/* ===== Phase E: 场景视觉样式 ===== */
.scene-era-card {
  text-align: center;
}
.scene-era-card .era-year {
  font-size: 80px;
  font-weight: 900;
  color: #fff;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  line-height: 1;
}
.scene-era-card .era-divider {
  width: 160px;
  height: 2px;
  margin: 16px auto;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
}
.scene-era-card .era-subtitle {
  font-size: 22px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

.scene-versus {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 60px;
  width: 100%;
}
.scene-versus .versus-side {
  font-size: 36px;
  font-weight: 700;
  color: rgba(150, 200, 255, 0.95);
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
  text-align: center;
  max-width: 35%;
}
.scene-versus .versus-side.warm {
  color: rgba(255, 200, 150, 0.95);
}
.scene-versus .versus-center {
  font-size: 24px;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.6);
}

.scene-formula {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  padding: 32px 48px;
  text-align: center;
}
.scene-formula .formula-title {
  font-size: 32px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}
.scene-formula .formula-expr {
  font-size: 18px;
  font-family: "JetBrains Mono", "Consolas", monospace;
  color: rgba(180, 220, 255, 0.9);
  margin-top: 16px;
}

.scene-quote {
  text-align: center;
  position: relative;
  max-width: 70%;
}
.scene-quote .quote-mark {
  font-size: 80px;
  font-family: Georgia, serif;
  color: rgba(255, 255, 255, 0.12);
  position: absolute;
  top: -40px;
  left: -30px;
}
.scene-quote .quote-text {
  font-size: 26px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.95);
  font-family: "PingFang SC", serif;
  line-height: 1.6;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}
.scene-quote .quote-author {
  font-size: 16px;
  font-weight: 400;
  color: rgba(200, 200, 200, 0.7);
  margin-top: 20px;
}

.scene-timeline {
  display: flex;
  align-items: center;
  gap: 32px;
}
.scene-timeline .timeline-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 20px rgba(255, 255, 255, 0.5);
}
.scene-timeline .timeline-year {
  font-size: 36px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}
.scene-timeline .timeline-sub {
  font-size: 18px;
  color: rgba(200, 200, 200, 0.8);
  margin-top: 4px;
}

.preview-caption {
  position: absolute;
  bottom: 110px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.6);
  padding: 10px 28px;
  border-radius: 8px;
  max-width: 70%;
  text-align: center;
  font-size: 16px;
  color: #fff;
  border-left: 3px solid rgba(255, 255, 255, 0.6);
}

.preview-subtitle {
  position: absolute;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  padding: 12px 32px;
  border-radius: 10px;
  max-width: 80%;
  text-align: center;
  font-size: 18px;
  color: #fff;
  line-height: 1.5;
}

/* 调试条：显示当前段的 visual 状态（顶部小条） */
.preview-debug-bar {
  position: absolute;
  top: 50px;
  left: 12px;
  z-index: 20;
  display: flex;
  gap: 6px;
  align-items: center;
  background: rgba(0, 0, 0, 0.6);
  padding: 6px 10px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
}

.preview-badge {
  position: absolute;
  top: 12px;
  left: 12px;
}

.preview-controls {
  position: absolute;
  bottom: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  background: rgba(0, 0, 0, 0.6);
  padding: 6px 14px;
  border-radius: 20px;
}

/* ===== 工具栏 ===== */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding: 8px 12px;
  background: #f9f9f9;
  border-radius: 8px;
}

/* ===== 时间轴 ===== */
.timeline-wrap {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 12px;
  background: #fafafa;
  overflow-x: auto;
}

/* ===== 段列表 ===== */
.seg-detail-list {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.seg-detail {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  background: #fff;
  border-radius: 6px;
  border: 1px solid #eee;
  transition: all 0.2s;
}
.seg-detail.active {
  border-color: #18a058;
  background: #f0faf4;
  box-shadow: 0 0 0 2px rgba(24, 160, 88, 0.1);
}

/* ===== 底部 ===== */
.bottom-bar {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}
</style>
