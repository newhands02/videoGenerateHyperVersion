<script setup lang="ts">
import { ref, computed } from 'vue';
import { useMessage } from 'naive-ui';
import { useScriptStore } from '../stores/script';

const message = useMessage();
const script = useScriptStore();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const isDragging = ref(false);

const wordCount = computed(() => script.wordCount);
const estimatedDuration = computed(() => {
  const sec = script.estimatedDuration;
  const min = Math.floor(sec / 60);
  const s = Math.ceil(sec % 60);
  return min > 0 ? `${min}分${s}秒` : `${s}秒`;
});

/** 处理粘贴（去掉 Markdown） */
function handlePaste(e: ClipboardEvent) {
  e.preventDefault();
  const text = e.clipboardData?.getData('text/plain') ?? '';
  script.setRawText(text);
}

/** 导入 txt 文件 */
function handleFileImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.md,.text';
  input.onchange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    script.setRawText(text);
  };
  input.click();
}

/** 开始分段（进入 Step 2） */
function startSplitting() {
  if (script.wordCount === 0) {
    message.warning('请先输入或粘贴文案');
    return;
  }
  script.setRawText(script.rawText);
  script.splitByNewline();
  message.success(`已按回车分成 ${script.segmentCount} 段`);
}
</script>

<template>
  <div class="step1">
    <div class="step1-header">
      <h2>📝 文案输入</h2>
      <p class="subtitle">粘贴你的文章/脚本，支持 Markdown，自动转纯文本</p>
    </div>

    <div class="step1-body">
      <!-- 左侧：输入区 -->
      <div class="input-section">
        <div class="textarea-wrapper">
          <textarea
            ref="textareaRef"
            v-model="script.rawText"
            class="main-textarea"
            placeholder="在这里粘贴或输入你的文案...&#10;&#10;支持直接粘贴微信文章、公众号文章、Markdown 文件均可&#10;&#10;中文按 3.8 字/秒估算语速&#10;建议单段不超过 80 字（约 20 秒）"
            @paste="handlePaste"
          />
        </div>

        <div class="input-actions">
          <n-button size="small" @click="script.setRawText('')">清空</n-button>
          <n-button size="small" @click="handleFileImport">
            📂 导入文件
          </n-button>
          <div class="spacer" />
          <n-tag v-if="wordCount > 0" :bordered="false" type="info">
            {{ wordCount }} 字
          </n-tag>
          <n-tag v-if="wordCount > 0" :bordered="false" type="warning">
            约 {{ estimatedDuration }}
          </n-tag>
        </div>
      </div>

      <!-- 右侧：提示区 -->
      <div class="tips-section">
        <n-card size="small" title="💡 小贴士">
          <ul>
            <li>直接粘贴微信文章、公众号文章、Markdown 文件均可</li>
            <li>中文按 <strong>3.8 字/秒</strong>估算语速</li>
            <li>建议单段不超过 <strong>80 字</strong>（约 20 秒）</li>
            <li>下一步可以 AI 智能分段，也可以手动调整</li>
          </ul>
        </n-card>

        <n-card size="small" title="📊 预估信息" style="margin-top: 12px">
          <n-space vertical>
            <div class="stat-row">
              <span>字数</span>
              <strong>{{ wordCount }}</strong>
            </div>
            <div class="stat-row">
              <span>预估时长</span>
              <strong>{{ estimatedDuration }}</strong>
            </div>
            <div class="stat-row">
              <span>建议段数</span>
              <strong>{{ Math.ceil(wordCount / 60) }}</strong>
            </div>
          </n-space>
        </n-card>
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="step1-footer">
      <n-button
        type="primary"
        size="large"
        :disabled="wordCount === 0"
        @click="startSplitting"
      >
        ✂️ 开始分段 →
      </n-button>
    </div>
  </div>
</template>

<style scoped>
.step1 {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
}

.step1-header {
  margin-bottom: 20px;
}

.step1-header h2 {
  margin: 0 0 4px 0;
  font-size: 22px;
}

.subtitle {
  color: #999;
  margin: 0;
  font-size: 14px;
}

.step1-body {
  display: flex;
  gap: 20px;
  flex: 1;
  min-height: 0;
}

.input-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.textarea-wrapper {
  flex: 1;
  display: flex;
  min-height: 0;
}

.main-textarea {
  width: 100%;
  min-height: 300px;
  padding: 16px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 15px;
  line-height: 1.8;
  resize: vertical;
  font-family: inherit;
  transition: border-color 0.2s;
}

.main-textarea:focus {
  outline: none;
  border-color: #18a058;
}

.input-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.spacer {
  flex: 1;
}

.tips-section {
  width: 280px;
  flex-shrink: 0;
}

.tips-section ul {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.8;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 14px;
}

.step1-footer {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
</style>
