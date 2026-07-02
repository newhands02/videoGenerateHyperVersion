<script setup lang="ts">
import { NCard, NSpace, NButton, NAlert, NText, NTag } from 'naive-ui';
import { useScriptStore } from '@/stores/script';
import { useRouter } from 'vue-router';

const script = useScriptStore();
const router = useRouter();
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">② 脚本分段</h1>
      <p class="page-subtitle">三种模式：手动分段 / AI 智能分段 / AI 提议 + 人工编辑协同</p>
    </div>

    <NAlert type="warning" :show-icon="true" style="margin-bottom: 16px">
      Phase A 占位页。Phase B 接入：① 手动分段编辑器（拖拽重排）② DeepSeek V4 Pro 智能分段
      ③ AI 协同（置信度展示、逐段采纳/拒绝）。
    </NAlert>

    <NCard title="当前输入">
      <NText>{{ script.rawText.slice(0, 200) }}{{ script.rawText.length > 200 ? '…' : '' }}</NText>
      <template #action>
        <NSpace>
          <NTag :bordered="false">{{ script.wordCount }} 字</NTag>
          <NTag :bordered="false" type="info">~{{ script.estimatedDuration.toFixed(1) }}s</NTag>
          <NButton @click="router.push('/step/1')">返回修改</NButton>
          <NButton type="primary" @click="router.push('/step/3')">下一步</NButton>
        </NSpace>
      </template>
    </NCard>
  </div>
</template>
