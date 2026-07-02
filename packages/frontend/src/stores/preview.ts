/**
 * 预览面板 store
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const usePreviewStore = defineStore('preview', () => {
  /** 预览 HTML 字符串（compileHtml 输出） */
  const html = ref('');
  const compiling = ref(false);

  function setHtml(h: string) {
    html.value = h;
  }

  function setCompiling(b: boolean) {
    compiling.value = b;
  }

  return { html, compiling, setHtml, setCompiling };
});
