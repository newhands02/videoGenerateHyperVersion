<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { useScriptStore } from '../stores/script';
import { useProjectStore } from '../stores/project';
import { useRouter } from 'vue-router';
import {
  NButton, NTag, NText, NSlider, NModal, NCard,
  NSpace, NList, NListItem, NThing, NAlert, NSpin,
  NDivider, useMessage,
} from 'naive-ui';
import { exportProject, downloadBlob } from '../lib/exporter';

const script = useScriptStore();
const project = useProjectStore();
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
let playTimer: number | null = null;

const draggingSegId = ref<string | null>(null);
const dragStartX = ref(0);
const dragOrigStart = ref(0);

function segStyle(seg: { index: number; audioDuration?: number }) {
  const start = script.segments
    .slice(0, seg.index)
    .reduce((sum, s) => sum + (s.audioDuration ?? 3), 0);
  const left = 60 + start * pxPerSecond.value;
  const width = Math.max((seg.audioDuration ?? 3) * pxPerSecond.value, 40);
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

// -------- 播放 --------
function togglePlay() {
  if (isPlaying.value) stopPlay();
  else startPlay();
}

function startPlay() {
  isPlaying.value = true;
  playTimer = window.setInterval(() => {
    playheadSec.value += 0.1;
    if (playheadSec.value >= totalDuration.value) {
      stopPlay();
      playheadSec.value = 0;
    }
  }, 100);
}

function stopPlay() {
  isPlaying.value = false;
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
}

function onRulerClick(e: MouseEvent) {
  const rect = (e.target as HTMLElement).getBoundingClientRect();
  const x = e.clientX - rect.left - 60;
  const sec = x / pxPerSecond.value;
  if (sec >= 0 && sec <= totalDuration.value) {
    playheadSec.value = Math.round(sec * 10) / 10;
  }
}

// -------- 导出 --------
async function handleExport() {
  showExportDialog.value = true;
  exporting.value = true;
  exportResult.value = null;
  try {
    // 同步到 project
    script.syncToProject();
    const proj = project.project;
    const segs = script.segments;

    const result = await exportProject(proj, segs);
    downloadBlob(result.blob, result.filename);
    exportResult.value = { filename: result.filename, fileCount: result.fileCount };
    message.success(`已下载 ${result.filename}`);
  } catch (err: any) {
    message.error(err.message || '导出失败');
  } finally {
    exporting.value = false;
  }
}

onUnmounted(() => { stopPlay(); });
</script>

<template>
  <div class="step-container">
    <h2>Step 4 · 时间轴编排</h2>
    <p class="desc">
      拖拽段块调整顺序，空格键播放/暂停。总时长：{{ fmt(totalDuration) }}。
    </p>

    <!-- 工具栏 -->
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

    <!-- 时间轴 SVG -->
    <div class="timeline-wrap">
      <svg :width="scaledWidth" height="120" style="overflow: visible;">
        <g @click="onRulerClick">
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

        <line
          :x1="60 + playheadSec * pxPerSecond"
          :x2="60 + playheadSec * pxPerSecond"
          y1="0"
          y2="110"
          stroke="#18a058"
          stroke-width="2"
          stroke-dasharray="4"
        />

        <g v-for="seg in script.segments" :key="seg.id">
          <rect
            :x="segStyle(seg).left"
            y="45"
            :width="segStyle(seg).width"
            height="50"
            :fill="seg.role === 'hook' ? '#ff6b6b' : seg.role === 'cta' ? '#51cf66' : '#4dabf7'"
            rx="6"
            opacity="0.85"
            :stroke="draggingSegId === seg.id ? '#333' : 'transparent'"
            stroke-width="2"
            style="cursor: grab;"
            @mousedown="(e: MouseEvent) => onDragStart(e, seg.id)"
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

    <!-- 段列表 -->
    <div class="seg-detail-list">
      <div v-for="seg in script.segments" :key="seg.id" class="seg-detail">
        <NTag size="tiny" :type="seg.role === 'hook' ? 'error' : seg.role === 'cta' ? 'success' : 'default'">
          段 {{ seg.index + 1 }}
        </NTag>
        <NText style="font-size: 13px; flex: 1; margin-left: 8px;">{{ seg.text.slice(0, 40) }}...</NText>
        <NText depth="3" style="font-size: 12px;">{{ seg.audioDuration ? fmt(seg.audioDuration) : '未合成' }}</NText>
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
            <NListItem>3. pip install edge-tts openai</NListItem>
            <NListItem>4. cp .env.example .env，填入 MIMO_API_KEY</NListItem>
            <NListItem>5. bash render.sh</NListItem>
            <NListItem>6. 等待完成，renders/output.mp4 就是你的视频</NListItem>
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
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding: 8px 12px;
  background: #f9f9f9;
  border-radius: 8px;
}
.timeline-wrap {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 12px;
  background: #fafafa;
  overflow-x: auto;
}
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
}
.bottom-bar {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}
</style>
