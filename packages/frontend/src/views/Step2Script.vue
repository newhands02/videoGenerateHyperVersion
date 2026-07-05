<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { useMessage } from 'naive-ui';
import { useScriptStore } from '../stores/script';
import { useRouter } from 'vue-router';
import type { SplitMode, SegmentRole } from '@webframes/shared-types';

const message = useMessage();

const script = useScriptStore();
const router = useRouter();

// -------- 模式切换 --------
const modes: { value: SplitMode; label: string; icon: string }[] = [
  { value: 'manual', label: '手动分段', icon: '✏️' },
  { value: 'ai', label: 'AI 分段', icon: '🤖' },
  { value: 'collab', label: 'AI 协同（推荐）', icon: '🤝' },
];

// -------- 分段列表编辑 --------
const editingId = ref<string | null>(null);
const editingText = ref('');

function startEdit(segId: string) {
  const seg = script.segments.find(s => s.id === segId);
  if (!seg) return;
  editingId.value = segId;
  editingText.value = seg.text;
  nextTick(() => {
    const el = document.querySelector(`[data-seg-id="${segId}"] .edit-input`) as HTMLTextAreaElement;
    el?.focus();
  });
}

function saveEdit() {
  if (editingId.value) {
    script.updateSegmentText(editingId.value, editingText.value);
  }
  cancelEdit();
}

function cancelEdit() {
  editingId.value = null;
  editingText.value = '';
}

/** 按回车拆分 */
function handleSegmentKeydown(segId: string, e: KeyboardEvent) {
  const target = e.target as HTMLTextAreaElement;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const cursorPos = target.selectionStart;
    script.splitSegment(segId, cursorPos);
    // 焦点移到新段
    nextTick(() => {
      const els = document.querySelectorAll('[data-seg-id]');
      const idx = [...els].findIndex(el => el.getAttribute('data-seg-id') === segId);
      if (idx >= 0 && idx < els.length - 1) {
        (els[idx + 1].querySelector('.edit-input') as HTMLElement)?.focus();
      }
    });
  }
}

// -------- AI 分段 --------
const aiLoading = ref(false);

async function runAiSplit() {
  if (script.rawText.trim().length === 0) {
    message.warning('请先输入文案');
    return;
  }
  aiLoading.value = true;
  script.setAiLoading();
  try {
    const { splitScript } = await import('../api/split');
    const result = await splitScript(script.rawText);
    script.setAiProposals(result.proposals);

    // AI 模式：自动采纳所有 proposals 到 segments
    if (script.splitMode === 'ai') {
      script.clearSegments();
      script.adoptAllProposals();
      message.success(`AI 分出 ${result.proposals.length} 段，已自动填充（含场景画面设计）`);
    } else {
      // 协同模式：不自动采纳，让用户选择
      message.success(`AI 分出 ${result.proposals.length} 段，请逐段采纳`);
    }
  } catch (err: any) {
    const msg = err.message || 'AI 分段失败';
    script.setAiError(msg);
    message.error(msg);
    // 降级：按回车分段
    script.splitByNewline();
    message.info('已降级为手动分段');
  } finally {
    aiLoading.value = false;
  }
}

/** 可视化模式标签 */
function visualModeLabel(mode?: string): string {
  const map: Record<string, string> = {
    'era-card': '年代卡',
    'versus': '对照',
    'formula': '公式',
    'quote': '引言',
    'timeline-marker': '时间线',
    'plain': '纯文字',
  };
  return map[mode ?? ''] ?? '';
}

function paletteLabel(palette?: string): string {
  const map: Record<string, string> = {
    indigo: '靛蓝',
    ember: '暖灰',
    ocean: '深海',
    forest: '青林',
    violet: '紫韵',
    amber: '琥珀',
  };
  return map[palette ?? ''] ?? '';
}

// -------- 角色标签颜色 --------
function roleColor(role?: SegmentRole): string {
  const map: Record<string, string> = {
    hook: 'pink',
    pain: 'orange',
    turn: 'cyan',
    climax: 'red',
    cta: 'green',
    transition: 'blue',
  };
  return map[role ?? ''] ?? 'default';
}

function roleLabel(role?: SegmentRole): string {
  const map: Record<string, string> = {
    hook: '钩子',
    pain: '痛点',
    turn: '转折',
    climax: '高潮',
    cta: '行动号召',
    transition: '过渡',
  };
  return map[role ?? ''] ?? '';
}

// -------- 置信度显示 --------
function confidenceColor(c: number): string {
  if (c >= 0.8) return '#18a058';
  if (c >= 0.5) return '#f0a020';
  return '#d03050';
}

// -------- 下一步 --------
function goNext() {
  if (script.segments.length === 0) {
    message.warning('请先完成分段');
    return;
  }
  script.syncToProject();
  router.push('/step/3');
}
</script>

<template>
  <div class="step2">
    <div class="step2-header">
      <h2>✂️ 脚本分段</h2>
      <p class="subtitle">选择分段模式，将文案切分成适合口播的段落</p>
    </div>

    <!-- 模式切换 -->
    <n-segmented
      :options="modes.map(m => ({ label: m.icon + ' ' + m.label, value: m.value }))"
      :value="script.splitMode"
      @update:value="script.setSplitMode($event as SplitMode)"
      class="mode-switcher"
      size="medium"
    />

    <!-- ======================== 模式 1：手动分段 ======================== -->
    <div v-if="script.splitMode === 'manual'" class="mode-panel">
      <div class="panel-toolbar">
        <n-button size="small" @click="script.splitByNewline()" :disabled="script.rawText.trim().length === 0">
          🔄 按回车重分
        </n-button>
        <n-button size="small" @click="script.addSegment()">
          ＋ 新增段
        </n-button>
        <div class="spacer" />
        <n-tag :bordered="false">{{ script.segmentCount }} 段</n-tag>
      </div>

      <div class="segments-list">
        <div
          v-for="(seg, idx) in script.segments"
          :key="seg.id"
          class="segment-card"
          :data-seg-id="seg.id"
        >
          <div class="seg-index">{{ idx + 1 }}</div>
          <div class="seg-body">
            <!-- 编辑中 -->
            <textarea
              v-if="editingId === seg.id"
              v-model="editingText"
              class="edit-input"
              @keydown="handleSegmentKeydown(seg.id, $event)"
              @blur="saveEdit"
              @keydown.enter.ctrl="saveEdit"
            />
            <!-- 查看态 -->
            <div
              v-else
              class="seg-text"
              @click="startEdit(seg.id)"
            >
              {{ seg.text || '（空段，点击输入）' }}
            </div>
            <div class="seg-meta">
              <n-tag v-if="seg.role" :bordered="false" :color="{ color: roleColor(seg.role) }" size="tiny">
                {{ roleLabel(seg.role) }}
              </n-tag>
              <span class="seg-duration">{{ Math.ceil(seg.text.length / 3.8) }}s</span>
              <span class="seg-chars">{{ seg.text.length }} 字</span>
            </div>
          </div>
          <div class="seg-actions">
            <n-button text size="tiny" @click="script.insertSegmentBefore(seg.id)" title="在此段前插入">⬆＋</n-button>
            <n-button text size="tiny" @click="script.addSegment(seg.id)" title="在此段后插入">⬇＋</n-button>
            <n-button text size="tiny" @click="script.moveUp(seg.id)" :disabled="idx === 0">↑</n-button>
            <n-button text size="tiny" @click="script.moveDown(seg.id)" :disabled="idx === script.segmentCount - 1">↓</n-button>
            <n-button text size="tiny" type="error" @click="script.removeSegment(seg.id)">×</n-button>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="script.segments.length === 0" class="empty-state">
          <p>暂无分段</p>
          <p class="hint">先在 Step 1 输入文案，或点"按回车重分"</p>
        </div>
      </div>
    </div>

    <!-- ======================== 模式 2：AI 分段 ======================== -->
    <div v-else-if="script.splitMode === 'ai'" class="mode-panel">
      <div class="ai-panel">
        <div class="ai-actions">
          <n-button
            type="primary"
            :loading="aiLoading"
            :disabled="script.rawText.trim().length === 0"
            @click="runAiSplit"
          >
            🤖 AI 智能分段
          </n-button>
          <n-button size="small" @click="script.restoreOriginal()">↩ 恢复原文</n-button>
        </div>

        <!-- AI 加载中 -->
        <div v-if="script.aiStatus === 'loading'" class="ai-loading">
          <n-spin size="medium" />
          <p>DeepSeek 正在分析文案，按叙事节奏切分中...</p>
          <p class="hint">（思考模式可能需 5-15 秒，请稍候）</p>
        </div>

        <!-- AI 结果 -->
        <div v-else-if="script.aiStatus === 'success' && script.aiProposals.length > 0" class="ai-results">
          <n-alert type="success" :show-icon="false" style="margin-bottom: 12px">
            AI 建议分成 {{ script.aiProposals.length }} 段，已自动填充（含场景画面设计）
          </n-alert>
          <!-- 采纳后的段列表 -->
          <div class="segments-list">
            <div
              v-for="(seg, idx) in script.segments"
              :key="seg.id"
              class="segment-card"
            >
              <div class="seg-index">{{ idx + 1 }}</div>
              <div class="seg-body">
                <div class="seg-text">{{ seg.text }}</div>
                <div class="seg-meta">
                  <n-tag :bordered="false" :color="{ color: roleColor(seg.role) }" size="tiny">
                    {{ roleLabel(seg.role) }}
                  </n-tag>
                  <n-tag v-if="seg.visual && seg.visual.mode !== 'plain'" :bordered="false" type="info" size="tiny">
                    🎬 {{ visualModeLabel(seg.visual.mode) }}
                  </n-tag>
                  <n-tag v-if="seg.visual?.palette" :bordered="false" size="tiny" round>
                    {{ paletteLabel(seg.visual.palette) }}
                  </n-tag>
                  <span class="seg-duration">{{ Math.ceil(seg.text.length / 3.8) }}s</span>
                  <span class="seg-chars">{{ seg.text.length }} 字</span>
                </div>
                <!-- visual 详情预览 -->
                <div v-if="seg.visual && seg.visual.mode !== 'plain'" class="seg-visual-preview">
                  <span v-if="seg.visual.mode === 'era-card'">📅 {{ seg.visual.era?.year }} · {{ seg.visual.era?.subtitle }}</span>
                  <span v-else-if="seg.visual.mode === 'versus'">⚔️ {{ seg.visual.versus?.left.label }} {{ seg.visual.versus?.center }} {{ seg.visual.versus?.right.label }}</span>
                  <span v-else-if="seg.visual.mode === 'formula'">📐 {{ seg.visual.formula?.title }}</span>
                  <span v-else-if="seg.visual.mode === 'quote'">💬 {{ seg.visual.quote?.author }}</span>
                  <span v-else-if="seg.visual.mode === 'timeline-marker'">📍 {{ seg.visual.era?.year }}</span>
                  <span v-if="seg.visual.caption" class="seg-visual-caption">— {{ seg.visual.caption }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 手动分段结果（降级） -->
        <div v-else class="segments-list">
          <div
            v-for="(seg, idx) in script.segments"
            :key="seg.id"
            class="segment-card"
          >
            <div class="seg-index">{{ idx + 1 }}</div>
            <div class="seg-body">
              <div class="seg-text">{{ seg.text }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ======================== 模式 3：AI 协同（推荐） ======================== -->
    <div v-else class="mode-panel">
      <div class="collab-panel">
        <!-- 操作栏 -->
        <div class="panel-toolbar">
          <n-button
            type="primary"
            :loading="aiLoading"
            :disabled="script.rawText.trim().length === 0"
            @click="runAiSplit"
          >
            🤖 AI 智能分段
          </n-button>
          <n-button size="small" @click="script.restoreOriginal()">↩ 恢复原文</n-button>
          <n-button
            v-if="script.aiProposals.length > 0"
            size="small"
            type="success"
            @click="script.adoptAllProposals()"
          >
            ⤴ 全部采纳
          </n-button>
          <div class="spacer" />
          <n-tag v-if="script.segments.length > 0" :bordered="false" type="success">
            已采纳 {{ script.segments.length }} 段
          </n-tag>
        </div>

        <!-- AI 提议列表 -->
        <div v-if="script.aiProposals.length > 0" class="proposals-section">
          <h4>🤖 AI 提议（{{ script.aiProposals.length }} 段）</h4>
          <div class="proposals-list">
            <div
              v-for="(p, idx) in script.aiProposals"
              :key="idx"
              class="proposal-card"
              :class="{ adopted: script.adoptedIndexes.has(idx) }"
            >
              <n-checkbox
                :checked="script.adoptedIndexes.has(idx)"
                @update:checked="(val: boolean) => val ? script.adoptProposal(idx) : script.rejectProposal(idx)"
              />
              <div class="proposal-body">
                <div class="proposal-text">{{ p.text }}</div>
                <div class="proposal-meta">
                  <n-tag :bordered="false" :color="{ color: roleColor(p.role) }" size="tiny">
                    {{ roleLabel(p.role) }}
                  </n-tag>
                  <n-tag v-if="p.visual && p.visual.mode !== 'plain'" :bordered="false" type="info" size="tiny">
                    🎬 {{ visualModeLabel(p.visual.mode) }}
                  </n-tag>
                  <n-tag v-if="p.visual?.palette" :bordered="false" size="tiny" round>
                    {{ paletteLabel(p.visual.palette) }}
                  </n-tag>
                  <div class="confidence-bar small">
                    <div
                      class="confidence-fill"
                      :style="{ width: (p.confidence * 100) + '%', backgroundColor: confidenceColor(p.confidence) }"
                    />
                    <span class="confidence-label">{{ Math.round(p.confidence * 100) }}%</span>
                  </div>
                </div>
                <!-- visual 详情预览 -->
                <div v-if="p.visual && p.visual.mode !== 'plain'" class="seg-visual-preview">
                  <span v-if="p.visual.mode === 'era-card'">📅 {{ p.visual.era?.year }} · {{ p.visual.era?.subtitle }}</span>
                  <span v-else-if="p.visual.mode === 'versus'">⚔️ {{ p.visual.versus?.left.label }} {{ p.visual.versus?.center }} {{ p.visual.versus?.right.label }}</span>
                  <span v-else-if="p.visual.mode === 'formula'">📐 {{ p.visual.formula?.title }}</span>
                  <span v-else-if="p.visual.mode === 'quote'">💬 {{ p.visual.quote?.author }}</span>
                  <span v-else-if="p.visual.mode === 'timeline-marker'">📍 {{ p.visual.era?.year }}</span>
                  <span v-if="p.visual.caption" class="seg-visual-caption">— {{ p.visual.caption }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 已采纳段落 -->
        <div v-if="script.segments.length > 0" class="adopted-section">
          <h4>✅ 已采纳段落（{{ script.segments.length }} 段）</h4>
          <div class="segments-list">
            <div
              v-for="(seg, idx) in script.segments"
              :key="seg.id"
              class="segment-card"
            >
              <div class="seg-index">{{ idx + 1 }}</div>
              <div class="seg-body">
                <textarea
                  v-if="editingId === seg.id"
                  v-model="editingText"
                  class="edit-input"
                  @blur="saveEdit"
                  @keydown.enter.ctrl="saveEdit"
                />
                <div v-else class="seg-text" @click="startEdit(seg.id)">{{ seg.text }}</div>
                <div class="seg-meta">
                  <n-tag v-if="seg.role" :bordered="false" :color="{ color: roleColor(seg.role) }" size="tiny">
                    {{ roleLabel(seg.role) }}
                  </n-tag>
                  <n-tag v-if="seg.visual && seg.visual.mode !== 'plain'" :bordered="false" type="info" size="tiny">
                    🎬 {{ visualModeLabel(seg.visual.mode) }}
                  </n-tag>
                  <span class="seg-duration">{{ Math.ceil(seg.text.length / 3.8) }}s</span>
                </div>
              </div>
              <div class="seg-actions">
                <n-button text size="tiny" @click="script.insertSegmentBefore(seg.id)" title="在此段前插入">⬆＋</n-button>
                <n-button text size="tiny" @click="script.addSegment(seg.id)" title="在此段后插入">⬇＋</n-button>
                <n-button text size="tiny" @click="script.removeSegment(seg.id)" type="error">×</n-button>
              </div>
            </div>
          </div>
          <n-button size="small" @click="script.addSegment()" style="margin-top: 8px">
            ＋ 手动新增段
          </n-button>
        </div>

        <!-- 空状态 -->
        <div v-if="script.segments.length === 0 && script.aiProposals.length === 0 && script.aiStatus !== 'loading'" class="empty-state">
          <p>点击「🤖 AI 智能分段」开始</p>
          <p class="hint">AI 会按叙事节奏（钩子→痛点→转折→高潮→CTA）切分文案</p>
        </div>

        <!-- AI 加载中 -->
        <div v-if="script.aiStatus === 'loading'" class="ai-loading">
          <n-spin size="medium" />
          <p>DeepSeek 正在分析...</p>
        </div>
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="step2-footer">
      <n-button @click="router.push('/')">← 上一步</n-button>
      <n-button
        type="primary"
        :disabled="script.segments.length === 0"
        @click="goNext"
      >
        下一步：场景编排 →
      </n-button>
    </div>
  </div>
</template>

<style scoped>
.step2 {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  overflow-y: auto;
}

.step2-header {
  margin-bottom: 16px;
}

.step2-header h2 {
  margin: 0 0 4px 0;
  font-size: 22px;
}

.subtitle {
  color: #999;
  margin: 0;
  font-size: 14px;
}

.mode-switcher {
  margin-bottom: 16px;
  display: flex;
  justify-content: center;
}

.mode-panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* -------- 通用分段卡片 -------- */
.segments-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.segment-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  background: #f9f9f9;
  border-radius: 8px;
  border: 1px solid #e8e8e8;
  transition: border-color 0.2s;
}

.segment-card:hover {
  border-color: #18a058;
}

.seg-index {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #18a058;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: bold;
  flex-shrink: 0;
}

.seg-body {
  flex: 1;
  min-width: 0;
}

.seg-text {
  font-size: 14px;
  line-height: 1.6;
  cursor: text;
  padding: 4px 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.seg-text:hover {
  background: #f0f0f0;
  border-radius: 4px;
}

.edit-input {
  width: 100%;
  min-height: 60px;
  padding: 8px;
  border: 2px solid #18a058;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
  font-family: inherit;
}

.edit-input:focus {
  outline: none;
}

.seg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
  color: #999;
}

.seg-duration {
  background: #e8e8e8;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.seg-chars {
  color: #bbb;
}

.seg-visual-preview {
  margin-top: 6px;
  padding: 4px 8px;
  background: rgba(99, 102, 241, 0.08);
  border-left: 3px solid #6366f1;
  border-radius: 0 4px 4px 0;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
}

.seg-visual-caption {
  display: block;
  margin-top: 2px;
  color: #9ca3af;
  font-style: italic;
}

.seg-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

/* -------- 面板工具栏 -------- */
.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.spacer {
  flex: 1;
}

/* -------- AI 面板 -------- */
.ai-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px;
  color: #999;
}

.hint {
  font-size: 12px;
  color: #bbb;
}

/* -------- 置信度条 -------- */
.confidence-bar {
  width: 60px;
  height: 8px;
  background: #eee;
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  display: inline-flex;
  align-items: center;
}

.confidence-bar.small {
  width: 40px;
  height: 6px;
}

.confidence-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}

.confidence-label {
  position: absolute;
  right: -32px;
  font-size: 10px;
  color: #999;
}

/* -------- 协同模式 -------- */
.proposals-section,
.adopted-section {
  margin-bottom: 20px;
}

.proposals-section h4,
.adopted-section h4 {
  margin: 0 0 12px 0;
  font-size: 15px;
}

.proposal-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 14px;
  background: #f9f9f9;
  border-radius: 8px;
  border: 1px solid #e8e8e8;
  margin-bottom: 8px;
  transition: all 0.2s;
}

.proposal-card.adopted {
  background: #f0faf4;
  border-color: #18a058;
  opacity: 0.7;
}

.proposal-body {
  flex: 1;
  min-width: 0;
}

.proposal-text {
  font-size: 14px;
  line-height: 1.6;
}

.proposal-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

/* -------- 空状态 -------- */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #999;
  font-size: 15px;
}

.empty-state .hint {
  font-size: 13px;
  margin-top: 8px;
}

/* -------- 底部 -------- */
.step2-footer {
  margin-top: 20px;
  display: flex;
  justify-content: space-between;
}
</style>
