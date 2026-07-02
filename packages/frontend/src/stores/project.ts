/**
 * 项目 store：管理整个 Project 状态
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Project, Resolution, TTSEngine } from '@webframes/shared-types';

function newProject(): Project {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: '未命名项目',
    createdAt: now,
    updatedAt: now,
    resolution: { width: 1920, height: 1080, label: '1080p' },
    ttsEngine: 'mimo',
    segments: [],
    scenes: [],
    meta: {
      themeColor: '#18a058',
      fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      totalDuration: 0,
    },
  };
}

export const useProjectStore = defineStore('project', () => {
  const project = ref<Project>(newProject());

  const segmentCount = computed(() => project.value.segments.length);
  const totalDuration = computed(() =>
    project.value.segments.reduce((sum, s) => sum + (s.audioDuration ?? 0), 0),
  );

  function setName(name: string) {
    project.value.name = name;
    project.value.updatedAt = new Date().toISOString();
  }

  function setResolution(res: Resolution) {
    project.value.resolution = res;
    project.value.updatedAt = new Date().toISOString();
  }

  function setTtsEngine(engine: TTSEngine) {
    project.value.ttsEngine = engine;
    project.value.updatedAt = new Date().toISOString();
  }

  function touch() {
    project.value.updatedAt = new Date().toISOString();
  }

  return {
    project,
    segmentCount,
    totalDuration,
    setName,
    setResolution,
    setTtsEngine,
    touch,
  };
});
