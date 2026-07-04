<script setup lang="ts">
/**
 * 音色复刻对话框
 * 用户上传音频样本 → 调用 MiMo voiceclone 模型试听 → 保存到 IndexedDB
 */
import { ref, computed } from 'vue';
import {
  NModal, NCard, NForm, NFormItem, NInput, NButton, NSpace,
  NTag, NText, NAlert, NUpload, useMessage,
} from 'naive-ui';
import type { UploadFileInfo } from 'naive-ui';
import type { CloneVoice, VoiceSample } from '@webframes/shared-types';
import { useVoicesStore } from '../stores/voices';
import { synthTts } from '../api/tts';

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ 'update:show': [val: boolean] }>();

const message = useMessage();
const voices = useVoicesStore();

// 表单状态
const name = ref('');
const previewText = ref('你好，这是我的音色复刻测试。');
const sampleBlob = ref<Blob | null>(null);
const sampleName = ref('');
const sampleDuration = ref(0);
const sampleMime = ref('');
const sampleSize = ref(0);
const previewing = ref(false);
const previewAudioUrl = ref<string | null>(null);
const saving = ref(false);

const canPreview = computed(() => !!sampleBlob.value && previewText.value.trim().length > 0);
const canSave = computed(() => name.value.trim().length > 0 && canPreview.value);

/** 文件上传处理 */
function handleFileChange(options: { fileList: UploadFileInfo[] }) {
  const file = options.fileList[0]?.file;
  if (!file) {
    resetSample();
    return;
  }

  // 验证大小（≤ 10MB）
  if (file.size > 10 * 1024 * 1024) {
    message.error('文件超过 10MB 限制');
    return;
  }

  // 验证类型
  const validTypes = ['audio/mpeg', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mp3', 'audio/ogg'];
  if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|ogg)$/i)) {
    message.error('仅支持 mp3/wav/ogg 格式');
    return;
  }

  sampleBlob.value = file;
  sampleName.value = file.name;
  sampleMime.value = file.type || 'audio/mpeg';
  sampleSize.value = file.size;

  // 测量时长
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  audio.addEventListener('loadedmetadata', () => {
    sampleDuration.value = Math.round(audio.duration * 10) / 10;
    URL.revokeObjectURL(url);
  });
  audio.addEventListener('error', () => {
    sampleDuration.value = 0;
    URL.revokeObjectURL(url);
  });
  audio.src = url;
}

function resetSample() {
  sampleBlob.value = null;
  sampleName.value = '';
  sampleDuration.value = 0;
  sampleMime.value = '';
  sampleSize.value = 0;
}

/** 将 Blob 转 base64 data URL */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/** 试听 */
async function handlePreview() {
  if (!canPreview.value || !sampleBlob.value) return;
  previewing.value = true;
  previewAudioUrl.value = null;
  try {
    const sampleBase64 = await blobToBase64(sampleBlob.value);
    const data = await synthTts({
      text: previewText.value,
      voiceId: 'clone-preview',
      engine: 'mimo',
      voiceType: 'clone',
      voiceSampleBase64: sampleBase64,
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
  if (!canSave.value || !sampleBlob.value) return;
  saving.value = true;
  try {
    const sampleId = `sample-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const voiceId = `clone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const sample: VoiceSample = {
      id: sampleId,
      voiceId,
      mime: sampleMime.value,
      bytes: sampleSize.value,
      duration: sampleDuration.value,
      createdAt: new Date().toISOString(),
      blob: sampleBlob.value,
    };

    const voice: CloneVoice = {
      id: voiceId,
      kind: 'clone',
      alias: name.value.trim(),
      engine: 'mimo',
      lang: 'multi',
      sampleAudioId: sampleId,
      createdAt: new Date().toISOString(),
      isPreset: false,
    };

    await voices.saveCloneVoice(voice, sample);
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
  previewText.value = '你好，这是我的音色复刻测试。';
  resetSample();
  previewAudioUrl.value = null;
  emit('update:show', false);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <NModal
    :show="props.show"
    @update:show="emit('update:show', $event)"
    :mask-closable="false"
    style="width: 600px;"
  >
    <NCard title="复刻音色" :bordered="false" size="huge">
      <NForm label-placement="top">
        <NFormItem label="音色名称">
          <NInput v-model:value="name" placeholder="如：我的声音、同事老王" maxlength="20" show-count />
        </NFormItem>

        <NFormItem label="上传参考音频（mp3/wav，≤10MB，推荐 5-30 秒纯净人声）">
          <NUpload
            :max="1"
            accept=".mp3,.wav,.ogg,audio/*"
            :default-upload="false"
            @change="handleFileChange"
          >
            <NButton>📁 选择文件</NButton>
          </NUpload>
        </NFormItem>

        <!-- 已选文件信息 -->
        <div v-if="sampleBlob" class="sample-info">
          <NSpace align="center">
            <NTag type="success" size="small">✓</NTag>
            <NText>{{ sampleName }}</NText>
            <NText depth="3" style="font-size: 12px;">
              {{ formatSize(sampleSize) }}
              <template v-if="sampleDuration"> · {{ sampleDuration }}s</template>
            </NText>
            <NButton size="tiny" quaternary @click="resetSample">× 移除</NButton>
          </NSpace>
        </div>

        <NFormItem label="试听文本">
          <NInput
            v-model:value="previewText"
            type="textarea"
            :rows="2"
            placeholder="输入试听文案"
          />
        </NFormItem>

        <NAlert type="info" :bordered="false" style="margin-bottom: 12px;">
          复刻样本全局共享，跨项目可用。样本不会进入导出包，导出的 tts.py 需要用户自行提供样本。
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

<style scoped>
.sample-info {
  padding: 8px 12px;
  background: #f0f9eb;
  border-radius: 6px;
  margin-bottom: 12px;
}
</style>
