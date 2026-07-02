/**
 * 时间轴 store
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useTimelineStore = defineStore('timeline', () => {
  /** 播放头位置（秒） */
  const playhead = ref(0);
  /** 是否正在播放 */
  const isPlaying = ref(false);

  const playheadPercent = computed(() => 0); // Phase B 接入总时长

  function seek(_t: number) {
    // Phase B 实现
  }

  function play() {
    isPlaying.value = true;
  }

  function pause() {
    isPlaying.value = false;
  }

  return { playhead, isPlaying, playheadPercent, seek, play, pause };
});
