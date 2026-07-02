<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { NCard, NInput, NSpace, NStatistic, NButton, NText, NAlert } from 'naive-ui';
import { useScriptStore } from '@/stores/script';
import { useProjectStore } from '@/stores/project';

const script = useScriptStore();
const project = useProjectStore();
const router = useRouter();

const minutes = computed(() => (script.estimatedDuration / 60).toFixed(2));

function next() {
  // Phase B：在 ProjectStore 里同步文案（暂时先跳转）
  router.push('/step/2');
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">① 输入文案</h1>
      <p class="page-subtitle">粘贴文章、演讲稿、故事……支持 Markdown 粘贴，会自动转纯文本</p>
    </div>

    <NAlert type="info" :show-icon="true" style="margin-bottom: 16px">
      Phase A 阶段：粘贴后可直接跳到第 ② 步做手动分段；Phase B 会接入 AI 智能分段。
    </NAlert>

    <NCard title="文案内容">
      <NInput
        v-model:value="script.rawText"
        type="textarea"
        :rows="14"
        placeholder="把你的文章粘贴到这里……"
        :autosize="{ minRows: 14, maxRows: 24 }"
      />
    </NCard>

    <NSpace style="margin-top: 16px" :wrap="false" align="center">
      <NStatistic label="字数" :value="script.wordCount" />
      <NStatistic label="预估时长（秒）" :value="script.estimatedDuration.toFixed(1)" />
      <NStatistic label="≈ 分钟" :value="minutes" />
      <span style="flex: 1" />
      <NText depth="3">项目：{{ project.project.name }}</NText>
      <NButton type="primary" :disabled="script.wordCount === 0" @click="next">
        下一步：脚本分段
      </NButton>
    </NSpace>
  </div>
</template>
