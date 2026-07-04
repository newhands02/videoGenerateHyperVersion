/**
 * 音色库 store
 * 合并来源：后端预置音色 + IndexedDB 自建音色（design/clone）
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { VoiceEntry, DesignVoice, CloneVoice, VoiceSample } from '@webframes/shared-types';
import { fetchVoices } from '@/api/voices';
import { idbGetAllVoices, idbPutVoice, idbDeleteVoice, idbPutSample, idbGetSample } from '@/lib/idb';

export const useVoicesStore = defineStore('voices', () => {
  /** 后端预置音色 */
  const presetVoices = ref<VoiceEntry[]>([]);
  /** IndexedDB 自建音色 */
  const customVoices = ref<VoiceEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** 合并后的全部音色 */
  const entries = computed<VoiceEntry[]>(() => [
    ...presetVoices.value,
    ...customVoices.value,
  ]);

  /** 按类型分组 */
  const presetEntries = computed(() => entries.value.filter(v => v.kind === 'preset'));
  const designEntries = computed(() => entries.value.filter(v => v.kind === 'design'));
  const cloneEntries = computed(() => entries.value.filter(v => v.kind === 'clone'));

  /** 加载预置 + 自建音色 */
  async function load() {
    if (presetVoices.value.length > 0) return;
    loading.value = true;
    error.value = null;
    try {
      // 并行加载后端预置 + IndexedDB 自建
      const [preset, custom] = await Promise.all([
        fetchVoices(),
        idbGetAllVoices<VoiceEntry>().catch(() => [] as VoiceEntry[]),
      ]);
      presetVoices.value = preset;
      customVoices.value = custom;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载音色失败';
    } finally {
      loading.value = false;
    }
  }

  /** 保存设计音色到 IndexedDB */
  async function saveDesignVoice(voice: DesignVoice): Promise<void> {
    await idbPutVoice(voice);
    // 更新内存
    const idx = customVoices.value.findIndex(v => v.id === voice.id);
    if (idx >= 0) {
      customVoices.value[idx] = voice;
    } else {
      customVoices.value.push(voice);
    }
  }

  /** 保存复刻音色 + 样本到 IndexedDB */
  async function saveCloneVoice(voice: CloneVoice, sample: VoiceSample): Promise<void> {
    await idbPutSample(sample);
    await idbPutVoice(voice);
    const idx = customVoices.value.findIndex(v => v.id === voice.id);
    if (idx >= 0) {
      customVoices.value[idx] = voice;
    } else {
      customVoices.value.push(voice);
    }
  }

  /** 获取复刻样本 Blob */
  async function getSampleBlob(sampleAudioId: string): Promise<Blob | null> {
    const sample = await idbGetSample<VoiceSample>(sampleAudioId);
    return sample?.blob ?? null;
  }

  /** 获取复刻样本的 base64（用于 TTS API） */
  async function getSampleBase64(sampleAudioId: string): Promise<string | null> {
    const blob = await getSampleBlob(sampleAudioId);
    if (!blob) return null;
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  /** 删除自建音色 */
  async function deleteCustomVoice(id: string): Promise<void> {
    const voice = customVoices.value.find(v => v.id === id);
    if (voice?.kind === 'clone') {
      // 同时删除样本
      const { idbDeleteSample } = await import('@/lib/idb');
      await idbDeleteSample(voice.sampleAudioId).catch(() => {});
    }
    await idbDeleteVoice(id);
    customVoices.value = customVoices.value.filter(v => v.id !== id);
  }

  /** 根据 ID 查找音色 */
  function findById(id: string): VoiceEntry | undefined {
    return entries.value.find(v => v.id === id);
  }

  return {
    presetVoices,
    customVoices,
    entries,
    presetEntries,
    designEntries,
    cloneEntries,
    loading,
    error,
    load,
    saveDesignVoice,
    saveCloneVoice,
    getSampleBlob,
    getSampleBase64,
    deleteCustomVoice,
    findById,
  };
});
