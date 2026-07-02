<script setup lang="ts">
import { NCard, NEmpty, NButton, NText, NTag } from 'naive-ui';
import { useProjectStore } from '@/stores/project';
import { useRouter } from 'vue-router';

const project = useProjectStore();
const router = useRouter();
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">④ 时间轴</h1>
      <p class="page-subtitle">拖拽调整每段时长、试听音频、实时预览（Phase B/C 实现）</p>
    </div>

    <NEmpty
      v-if="project.segmentCount === 0"
      description="还没有内容，请先回到前几步"
    >
      <template #extra>
        <NButton type="primary" @click="router.push('/step/1')">开始</NButton>
      </template>
    </NEmpty>

    <template v-else>
      <NCard title="预览">
        <NText>共 {{ project.segmentCount }} 段 · 总时长 {{ project.totalDuration.toFixed(1) }}s</NText>
        <template #action>
          <NTag :bordered="false" type="info">Phase C 实现</NTag>
        </template>
      </NCard>
    </template>
  </div>
</template>
