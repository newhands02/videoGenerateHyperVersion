/**
 * 音色库 store
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { VoiceEntry } from '@webframes/shared-types';
import { fetchVoices } from '@/api/voices';

export const useVoicesStore = defineStore('voices', () => {
  const entries = ref<VoiceEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    if (entries.value.length > 0) return;
    loading.value = true;
    error.value = null;
    try {
      entries.value = await fetchVoices();
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载音色失败';
    } finally {
      loading.value = false;
    }
  }

  return { entries, loading, error, load };
});
