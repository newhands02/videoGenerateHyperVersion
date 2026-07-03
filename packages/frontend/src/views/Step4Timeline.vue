<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useScriptStore } from '../stores/script';
import { useRouter } from 'vue-router';
import { NButton, NTag, NText, NSlider } from 'naive-ui';

const script = useScriptStore();
const router = useRouter();

// -------- 时间轴状态 --------
const timelineWidth = 800; // px
const pxPerSecond = ref(4); // 缩放比例
const totalDuration = computed(() => script.totalDuration);
const scaledWidth = computed(() => totalDuration.value * pxPerSecond.value + 120);

// 播放头
const playheadSec = ref(0);
const isPlaying = ref(false);
let playTimer: number | null = null;

// 拖拽状态
const draggingSegId = ref<string | null>(null);
const dragStartX = ref(0);
const dragOrigStart = ref(0);

/** 计算段在时间轴上的位置和宽度 */
function segStyle(seg: { index: number; audioDuration?: number }) {
  const start = script.segments
    .slice(0, seg.index)
    .reduce((sum, s) => sum + (s.audioDuration ?? 3), 0);
  const left = 60 + start * pxPerSecond.value;
  const width = Math.max((seg.audioDuration ?? 3) * pxPerSecond.value, 40);
  return { left, width, start };
}

/** 格式化秒为 MM:SS */
function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 刻度线 */
const ticks = computed(() => {
  const ticks: number[] = [];
  const step = totalDuration.value > 120 ? 10 : totalDuration.value > 60 ? 5 : 1;
  for (let t = 0; t <= totalDuration.value; t += step) {
    ticks.push(t);
  }
  return ticks;
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
  // 计算新的 index（简化：只允许重排顺序，不改时间）
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
  if (isPlaying.value) {
    stopPlay();
  } else {
    startPlay();
  }
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
        <!-- 标尺 -->
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
        <g
          v-for="seg in script.segments"
          :key="seg.id"
        >
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
          >
            {{ `段${seg.index + 1}` }}
          </text>
          <text
            :x="segStyle(seg).left + 6"
            y="82"
            font-size="10"
            fill="rgba(255,255,255,0.8)"
            pointer-events="none"
          >
            {{ seg.audioDuration ? fmt(seg.audioDuration) : '?' }}
          </text>
        </g>
      </svg>
    </div>

    <!-- 段列表（详情） -->
    <div class="seg-detail-list">
      <div
        v-for="seg in script.segments"
        :key="seg.id"
        class="seg-detail"
      >
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
      <NButton type="primary" @click="router.push('/')">
        ✅ 完成编辑
      </NButton>
    </div>
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
