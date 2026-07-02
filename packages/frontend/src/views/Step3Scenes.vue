<script setup lang="ts">
import { NCard, NEmpty, NButton, NSpace, NText } from 'naive-ui';
import { useProjectStore } from '@/stores/project';
import { useVoicesStore } from '@/stores/voices';
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

const project = useProjectStore();
const voices = useVoicesStore();
const router = useRouter();

onMounted(() => {
  voices.load();
});
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">③ 配场景</h1>
      <p class="page-subtitle">为每段文案选一个场景模板（Phase B 实现）</p>
    </div>

    <NEmpty
      v-if="project.segmentCount === 0"
      description="还没有分段，请先回到第 ② 步"
    >
      <template #extra>
        <NButton type="primary" @click="router.push('/step/2')">去分段</NButton>
      </template>
    </NEmpty>

    <template v-else>
      <NSpace vertical :size="12">
        <NText>共 {{ project.segmentCount }} 段，4 个内置模板：纯色标题、渐变文字、分屏对话、数据卡片</NText>
        <NButton type="primary" @click="router.push('/step/4')">下一步：时间轴</NButton>
      </NSpace>
    </template>

    <NText v-if="voices.error" type="error" depth="3" style="display: block; margin-top: 12px">
      加载音色失败：{{ voices.error }}
    </NText>
  </div>
</template>
