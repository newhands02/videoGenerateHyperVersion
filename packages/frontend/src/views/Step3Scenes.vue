<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useScriptStore } from '../stores/script';
import { useVoicesStore } from '../stores/voices';
import { useProjectStore } from '../stores/project';
import { useRouter } from 'vue-router';
import {
  NButton, NSelect, NTag, NText, NCard, NSpace, NSpin,
  NAlert, NDivider, NDropdown, useMessage,
} from 'naive-ui';
import type { SelectGroupOption, SelectOption } from 'naive-ui';
import type { ScriptSegment, VoiceEntry, DesignVoice, CloneVoice } from '@webframes/shared-types';
import VoiceDesignDialog from '../components/VoiceDesignDialog.vue';
import VoiceCloneDialog from '../components/VoiceCloneDialog.vue';
import VoiceLibraryDialog from '../components/VoiceLibraryDialog.vue';

const script = useScriptStore();
const voices = useVoicesStore();
const project = useProjectStore();
const router = useRouter();
const message = useMessage();

// 对话框状态
const showDesignDialog = ref(false);
const showCloneDialog = ref(false);
const showLibraryDialog = ref(false);

onMounted(() => {
  voices.load();
});

const canSynthesize = computed(() => script.segmentCount > 0);

/** 分组音色下拉选项 */
const voiceOptions = computed<(SelectOption | SelectGroupOption)[]>(() => {
  const groups: (SelectOption | SelectGroupOption)[] = [];

  // 预置音色组
  if (voices.presetEntries.length > 0) {
    groups.push({
      type: 'group',
      label: '预置音色',
      key: 'preset-group',
      children: voices.presetEntries.map(v => ({
        label: `${v.alias}（${v.gender === 'female' ? '女' : v.gender === 'male' ? '男' : '中'}·${v.lang === 'zh-CN' ? '中文' : v.lang === 'en-US' ? '英文' : '多语'}）`,
        value: v.id,
      })),
    });
  }

  // 设计音色组
  if (voices.designEntries.length > 0) {
    groups.push({
      type: 'group',
      label: '我设计的音色',
      key: 'design-group',
      children: voices.designEntries.map(v => ({
        label: `${v.alias}（设计）`,
        value: v.id,
      })),
    });
  }

  // 复刻音色组
  if (voices.cloneEntries.length > 0) {
    groups.push({
      type: 'group',
      label: '我复刻的音色',
      key: 'clone-group',
      children: voices.cloneEntries.map(v => ({
        label: `${v.alias}（复刻）`,
        value: v.id,
      })),
    });
  }

  return groups;
});

/** 获取段的音色显示名 */
function getVoiceName(voiceId: string): string {
  const v = voices.findById(voiceId);
  return v?.alias ?? voiceId;
}

/** 批量 TTS */
async function synthesizeAll() {
  if (!canSynthesize.value) return;
  message.info(`开始批量合成 ${script.segmentCount} 段...`);
  await script.synthesizeAll();
  message.success('批量合成完成');
}

/** 跳转 Step 4 */
function goNext() {
  script.syncToProject();
  router.push('/step/4');
}

/** 音色下拉菜单底部操作 */
const dropdownActions = [
  { label: '🎵 设计新音色', key: 'design' },
  { label: '🎙️ 复刻新音色', key: 'clone' },
  { label: '⚙️ 音色库管理', key: 'library' },
];

function handleDropdownAction(key: string) {
  if (key === 'design') showDesignDialog.value = true;
  else if (key === 'clone') showCloneDialog.value = true;
  else if (key === 'library') showLibraryDialog.value = true;
}
</script>

<template>
  <div class="step-container">
    <h2>Step 3 · 场景编排 & TTS 试听</h2>
    <p class="desc">
      为每段选择音色，点击 <NText type="info">🔊 合成</NText> 生成并播放音频，确认无误后进入时间轴。
    </p>

    <!-- 批量操作栏 -->
    <div class="batch-bar">
      <NButton
        type="primary"
        :loading="script.synthesizingIds.size > 0"
        :disabled="!canSynthesize"
        @click="synthesizeAll"
      >
        批量 TTS 合成（{{ script.segmentCount }} 段）
      </NButton>
      <NDropdown
        :options="dropdownActions"
        placement="bottom-start"
        trigger="click"
        @select="handleDropdownAction"
      >
        <NButton style="margin-left: 12px">⚙️ 音色库</NButton>
      </NDropdown>
      <div style="flex: 1;" />
      <NButton type="success" @click="goNext">
        进入时间轴 →
      </NButton>
    </div>

    <NDivider />

    <!-- 加载中 -->
    <NSpin v-if="voices.loading" size="small">
      <div style="height: 40px;" />
    </NSpin>

    <!-- 错误提示 -->
    <NAlert v-if="voices.error" type="warning" :bordered="false" style="margin-bottom: 12px;">
      {{ voices.error }}
    </NAlert>

    <!-- 段列表 -->
    <div class="segment-list">
      <NCard
        v-for="seg in script.segments"
        :key="seg.id"
        size="small"
        class="segment-card"
        :class="{ playing: script.playingId === seg.id }"
      >
        <div class="seg-header">
          <NTag size="small" :type="seg.role === 'hook' ? 'error' : seg.role === 'cta' ? 'success' : 'default'">
            段 {{ seg.index + 1 }}
            <template v-if="seg.role">· {{ seg.role }}</template>
          </NTag>
          <NText depth="3" style="font-size: 12px;">
            {{ seg.text.length }} 字
            <template v-if="seg.audioDuration">· {{ Math.round(seg.audioDuration) }}s</template>
          </NText>
        </div>

        <div class="seg-text">{{ seg.text }}</div>

        <div class="seg-controls">
          <!-- 音色选择 -->
          <div class="control-row">
            <span class="label">音色：</span>
            <NSelect
              :value="seg.tts.voiceId"
              :options="voiceOptions"
              size="small"
              style="width: 280px"
              placeholder="选择音色"
              @update:value="(val: string) => script.updateSegmentTts(seg.id, { voiceId: val })"
            />
            <NDropdown
              :options="dropdownActions"
              placement="bottom"
              trigger="click"
              @select="handleDropdownAction"
            >
              <NButton size="small" quaternary>+</NButton>
            </NDropdown>
          </div>

          <!-- 语速 -->
          <div class="control-row">
            <span class="label">语速：</span>
            <NSelect
              :value="seg.tts.speed"
              :options="[
                { label: '慢速', value: 'slow' },
                { label: '正常', value: 'normal' },
                { label: '快速', value: 'fast' },
              ]"
              size="small"
              style="width: 120px"
              @update:value="(val: any) => script.updateSegmentTts(seg.id, { speed: val })"
            />
          </div>

          <!-- TTS + 播放 -->
          <div class="control-row actions">
            <NButton
              size="small"
              :loading="script.synthesizingIds.has(seg.id)"
              :disabled="!seg.text.trim()"
              @click="script.synthesizeSegment(seg.id)"
            >
              🔊 合成
            </NButton>

            <NButton
              size="small"
              :disabled="!seg.audioUrl"
              :type="script.playingId === seg.id ? 'error' : 'default'"
              @click="script.playingId === seg.id ? script.stopPlayback() : script.playSegment(seg.id)"
            >
              {{ script.playingId === seg.id ? '⏹ 停止' : '▶ 播放' }}
            </NButton>

            <NText v-if="seg.audioDuration" depth="3" style="font-size: 12px;">
              时长 {{ seg.audioDuration.toFixed(1) }}s
            </NText>

            <NText v-if="script.ttsErrors.has(seg.id)" type="error" style="font-size: 12px;">
              {{ script.ttsErrors.get(seg.id) }}
            </NText>
          </div>
        </div>
      </NCard>
    </div>

    <!-- 底部操作 -->
    <div class="bottom-bar">
      <NButton @click="router.push('/step/2')">← 返回分段</NButton>
      <NButton type="primary" @click="goNext">
        下一步：时间轴编排 →
      </NButton>
    </div>

    <!-- 对话框 -->
    <VoiceDesignDialog v-model:show="showDesignDialog" />
    <VoiceCloneDialog v-model:show="showCloneDialog" />
    <VoiceLibraryDialog v-model:show="showLibraryDialog" />
  </div>
</template>

<style scoped>
.step-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
}
.desc {
  color: #666;
  margin-bottom: 16px;
}
.batch-bar {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
.segment-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.segment-card {
  transition: box-shadow 0.2s;
}
.segment-card.playing {
  box-shadow: 0 0 0 2px #18a058;
}
.seg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.seg-text {
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  margin-bottom: 12px;
  padding: 8px;
  background: #f9f9f9;
  border-radius: 6px;
}
.seg-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.control-row .label {
  font-size: 13px;
  color: #666;
  min-width: 40px;
}
.actions {
  margin-top: 4px;
}
.bottom-bar {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #eee;
}
</style>
