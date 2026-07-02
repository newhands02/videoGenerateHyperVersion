/**
 * 文案输入 store
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useScriptStore = defineStore('script', () => {
  const rawText = ref('');
  const wordCount = computed(() =>
    rawText.value.replace(/\s/g, '').length,
  );
  /** 估算时长（秒）：中文按 3.8 字/秒，Phase C 用真实音频覆盖 */
  const estimatedDuration = computed(() => wordCount.value / 3.8);

  function setText(text: string) {
    rawText.value = text;
  }

  function clear() {
    rawText.value = '';
  }

  return { rawText, wordCount, estimatedDuration, setText, clear };
});
