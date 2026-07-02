<script setup lang="ts">
import { useRouter } from 'vue-router';
import { NCard, NButton, NSpace, NText, NTag } from 'naive-ui';
import { useProjectStore } from '@/stores/project';
import { useScriptStore } from '@/stores/script';

const router = useRouter();
const project = useProjectStore();
const script = useScriptStore();

const steps = [
  { num: 1, title: '输入文案', desc: '粘贴文章，统计字数和预估时长', path: '/step/1' },
  { num: 2, title: '脚本分段', desc: '手动 / AI / AI+人工协同三模式', path: '/step/2' },
  { num: 3, title: '配场景', desc: '选模板、调文字、改颜色', path: '/step/3' },
  { num: 4, title: '时间轴', desc: '拖拽时长、试听、预览', path: '/step/4' },
];

function go(path: string) {
  router.push(path);
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">{{ project.project.name }}</h1>
      <p class="page-subtitle">4 步编排出一个可导出的视频项目包</p>
    </div>

    <NSpace vertical :size="16">
      <NCard
        v-for="s in steps"
        :key="s.num"
        :title="`第 ${['一', '二', '三', '四'][s.num - 1]}步 · ${s.title}`"
        hoverable
        class="step-card"
      >
        <template #header-extra>
          <NTag :bordered="false" type="success" size="small">Phase {{ ['A', 'B', 'C', 'D'][s.num - 1] }}</NTag>
        </template>
        <NText depth="3">{{ s.desc }}</NText>
        <template #action>
          <NSpace justify="end">
            <NText v-if="s.num === 1" depth="3" style="font-size: 12px">
              已输入 {{ script.wordCount }} 字 · 预估 {{ script.estimatedDuration.toFixed(1) }}s
            </NText>
            <NText v-else depth="3" style="font-size: 12px">
              共 {{ project.segmentCount }} 段
            </NText>
            <NButton type="primary" @click="go(s.path)">开始</NButton>
          </NSpace>
        </template>
      </NCard>
    </NSpace>
  </div>
</template>

<style scoped>
.step-card {
  transition: var(--wf-transition);
}
.step-card:hover {
  transform: translateY(-1px);
}
</style>
