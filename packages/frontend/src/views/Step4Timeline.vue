<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from 'vue';
import { useScriptStore } from '../stores/script';
import { useProjectStore } from '../stores/project';
import { useRouter } from 'vue-router';
import {
  NButton, NTag, NText, NSlider, NModal, NCard,
  NSpace, NList, NListItem, NAlert, NSpin,
  NDivider, useMessage,
} from 'naive-ui';
import { exportProject, downloadBlob } from '../lib/exporter';
import { useVoicesStore } from '../stores/voices';
import type { ScriptSegment, SegmentRole } from '@webframes/shared-types';

const script = useScriptStore();
const project = useProjectStore();
const voices = useVoicesStore();
const router = useRouter();
const message = useMessage();

// -------- 导出状态 --------
const showExportDialog = ref(false);
const exporting = ref(false);
const exportResult = ref<{ filename: string; fileCount: number } | null>(null);

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

function sceneBg(seg: ScriptSegment | null): string {
  if (!seg) return 'linear-gradient(135deg, #1a1a2e, #16213e)';
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
      <div class="preview-content">
        <div class="preview-scene-text" v-if="currentScene">
          {{ currentScene.text }}
        </div>
        <div class="preview-scene-text placeholder" v-else>
          点击下方播放按钮预览视频
        </div>
      </div>

      <!-- 字幕条 -->
      <div class="preview-subtitle" v-if="currentScene">
        {{ currentScene.text }}
      </div>

      <!-- 段标记 -->
      <div class="preview-badge" v-if="currentScene">
        <NTag size="tiny" :bordered="false" type="info">
          段 {{ currentSegIndex >= 0 ? currentSegIndex + 1 : '?' }}
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
      <NButton type="warning" @click="handleExport" :loading="exporting">
        📦 导出项目
      </NButton>
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
