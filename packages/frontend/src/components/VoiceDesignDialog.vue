<script setup lang="ts">
/**
 * 音色设计对话框
 * 用户输入自然语言描述 → 调用 MiMo voicedesign 模型试听 → 保存到 IndexedDB
 */
import { ref, computed } from 'vue';
import {
  NModal, NCard, NForm, NFormItem, NInput, NButton, NSpace,
  NTag, NText, NSelect, NAlert, NSpin, useMessage,
} from 'naive-ui';
import type { DesignVoice } from '@webframes/shared-types';
import { useVoicesStore } from '../stores/voices';
import { synthTts } from '../api/tts';

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ 'update:show': [val: boolean] }>();

const message = useMessage();
const voices = useVoicesStore();

// 表单状态
const name = ref('');
const description = ref('');
const previewText = ref('你有没有这种感觉，每天早上醒来，不知道自己究竟在为什么而活。');
const previewing = ref(false);
const previewAudioUrl = ref<string | null>(null);
const saving = ref(false);

// 预设模板
const templates = [
  { label: '空灵少女', value: '二十岁左右的年轻女性，声音空灵清澈，带有淡淡的忧伤感，语速轻柔缓慢，像在耳边低语。' },
  { label: '新闻主播', value: '三十岁专业女性，声音沉稳有力，吐字清晰标准，语速适中偏快，像央视新闻主播。' },
  { label: '评书先生', value: '六十岁老年男性，声音沧桑浑厚，语调抑扬顿挫，带有说书人的节奏感，偶尔拖长尾音。' },
  { label: '深夜电台DJ', value: '三十岁男性，声音低沉磁性，语速缓慢温柔，像深夜电台主持人在跟听众谈心。' },
  { label: '运动解说', value: '三十岁男性，声音激昂高亢，语速极快，充满激情和爆发力，像体育赛事解说员。' },
  { label: 'ASMR 耳语', value: '年轻女性，声音极轻极柔，气声为主，缓慢而治愈，像在做 ASMR 耳语。' },
];

const canPreview = computed(() => description.value.trim().length > 0 && previewText.value.trim().length > 0);
const canSave = computed(() => name.value.trim().length > 0 && canPreview.value);

/** 试听 */
async function handlePreview() {
  if (!canPreview.value) return;
  previewing.value = true;
  previewAudioUrl.value = null;
  try {
    const data = await synthTts({
      text: previewText.value,
      voiceId: 'design-preview',
      engine: 'mimo',
      voiceType: 'design',
      voiceDescription: description.value,
      speed: 'normal',
    });
    const blob = await (await fetch(data.audioUrl)).blob();
    previewAudioUrl.value = URL.createObjectURL(blob);
    message.success('试听音频已生成');
  } catch (err: any) {
    message.error(err.message || '试听失败');
  } finally {
    previewing.value = false;
  }
}

/** 保存到音色库 */
async function handleSave() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    const voice: DesignVoice = {
      id: `design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'design',
      alias: name.value.trim(),
      engine: 'mimo',
      lang: 'multi',
      promptText: description.value.trim(),
      createdAt: new Date().toISOString(),
      isPreset: false,
    };
    await voices.saveDesignVoice(voice);
    message.success(`音色「${voice.alias}」已保存到音色库`);
    handleClose();
  } catch (err: any) {
    message.error(err.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

function handleClose() {
  name.value = '';
  description.value = '';
  previewText.value = '你有没有这种感觉，每天早上醒来，不知道自己究竟在为什么而活。';
  previewAudioUrl.value = null;
  emit('update:show', false);
}

function applyTemplate(val: string) {
  description.value = val;
}
</script>

<template>
  <NModal
    :show="props.show"
    @update:show="emit('update:show', $event)"
    :mask-closable="false"
    style="width: 600px;"
  >
    <NCard title="设计新音色" :bordered="false" size="huge">
      <NForm label-placement="top">
        <NFormItem label="音色名称">
          <NInput v-model:value="name" placeholder="如：沉稳大叔、治愈女声" maxlength="20" show-count />
        </NFormItem>

        <NFormItem label="音色描述（1-4 句自然语言，覆盖越多越好）">
          <NInput
            v-model:value="description"
            type="textarea"
            placeholder="五十多岁的中年男性，嗓音醇厚略带磁性，语速缓慢而沉稳，像一位老教授在讲述人生阅历。"
            :rows="4"
            maxlength="500"
            show-count
          />
        </NFormItem>

        <NFormItem label="预设模板（点击套用）">
          <NSpace :wrap="true">
            <NButton
              v-for="tpl in templates"
              :key="tpl.label"
              size="small"
              @click="applyTemplate(tpl.value)"
            >
              {{ tpl.label }}
            </NButton>
          </NSpace>
        </NFormItem>

        <NFormItem label="试听文本">
          <NInput
            v-model:value="previewText"
            type="textarea"
            :rows="2"
            placeholder="输入试听文案"
          />
        </NFormItem>

        <NAlert v-if="!previewAudioUrl && !previewing" type="info" :bordered="false" style="margin-bottom: 12px;">
          点击「试听」生成音频预览。音色不会保存为 ID，每次 TTS 都会重新合成（MiMo API 硬约束）。
        </NAlert>

        <NSpace v-if="previewAudioUrl" align="center" style="margin-bottom: 12px;">
          <NTag type="success" size="small">试听就绪</NTag>
          <audio :src="previewAudioUrl" controls style="height: 32px;" />
        </NSpace>

        <NSpace justify="end">
          <NButton @click="handleClose">取消</NButton>
          <NButton
            :loading="previewing"
            :disabled="!canPreview"
            @click="handlePreview"
          >
            试听 ▶
          </NButton>
          <NButton
            type="primary"
            :loading="saving"
            :disabled="!canSave"
            @click="handleSave"
          >
            保存到音色库 ✓
          </NButton>
        </NSpace>
      </NForm>
    </NCard>
  </NModal>
</template>
