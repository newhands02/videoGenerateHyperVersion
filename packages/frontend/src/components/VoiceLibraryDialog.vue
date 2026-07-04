<script setup lang="ts">
/**
 * 音色库管理对话框
 * Tab 切换：预置 / 我设计的 / 我复刻的
 * 自建音色可删除，预置音色可改名
 */
import { ref, computed } from 'vue';
import {
  NModal, NCard, NTabs, NTabPane, NButton, NSpace, NList,
  NListItem, NThing, NTag, NEmpty, NPopconfirm, useMessage,
} from 'naive-ui';
import type { VoiceEntry, DesignVoice, CloneVoice } from '@webframes/shared-types';
import { useVoicesStore } from '../stores/voices';

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ 'update:show': [val: boolean] }>();

const message = useMessage();
const voices = useVoicesStore();

const activeTab = ref('preset');

async function handleDelete(voice: VoiceEntry) {
  try {
    await voices.deleteCustomVoice(voice.id);
    message.success(`已删除「${voice.alias}」`);
  } catch (err: any) {
    message.error(err.message || '删除失败');
  }
}

function voiceLabel(v: VoiceEntry): string {
  const gender = v.gender === 'female' ? '女' : v.gender === 'male' ? '男' : '中';
  const lang = v.lang === 'zh-CN' ? '中文' : v.lang === 'zh-HK' ? '粤语' : v.lang === 'en-US' ? '英文' : '多语';
  return `${gender}·${lang}`;
}
</script>

<template>
  <NModal
    :show="props.show"
    @update:show="emit('update:show', $event)"
    style="width: 680px;"
  >
    <NCard title="我的音色库" :bordered="false" size="huge">
      <NTabs v-model:value="activeTab" type="line">
        <!-- 预置音色 -->
        <NTabPane name="preset" :tab="`预置音色（${voices.presetEntries.length}）`">
          <NList bordered>
            <NListItem v-for="v in voices.presetEntries" :key="v.id">
              <NThing>
                <template #header>
                  <NSpace align="center" :size="6">
                    <span>{{ v.alias }}</span>
                    <NTag size="tiny" :bordered="false">{{ voiceLabel(v) }}</NTag>
                    <NTag v-if="v.isPreset" size="tiny" type="info" :bordered="false">预置</NTag>
                  </NSpace>
                </template>
                <template #description>
                  <span style="font-size: 12px; color: #999;">
                    ID: {{ v.kind === 'preset' ? v.nativeId : v.id }}
                  </span>
                </template>
              </NThing>
            </NListItem>
          </NList>
        </NTabPane>

        <!-- 我设计的音色 -->
        <NTabPane name="design" :tab="`我设计的（${voices.designEntries.length}）`">
          <NEmpty v-if="voices.designEntries.length === 0" description="还没有设计音色，去 Step 3 点「设计新音色」" />
          <NList v-else bordered>
            <NListItem v-for="v in voices.designEntries" :key="v.id">
              <NThing>
                <template #header>
                  <NSpace align="center" :size="6">
                    <span>{{ v.alias }}</span>
                    <NTag size="tiny" type="warning" :bordered="false">设计</NTag>
                    <NPopconfirm @positive-click="handleDelete(v)">
                      <template #trigger>
                        <NButton size="small" type="error" quaternary>删除</NButton>
                      </template>
                      确定删除「{{ v.alias }}」？使用此音色的段会回退到默认。
                    </NPopconfirm>
                  </NSpace>
                </template>
                <template #description>
                  <span style="font-size: 12px; color: #666;">
                    {{ (v as DesignVoice).promptText.slice(0, 60) }}...
                  </span>
                </template>
              </NThing>
            </NListItem>
          </NList>
        </NTabPane>

        <!-- 我复刻的音色 -->
        <NTabPane name="clone" :tab="`我复刻的（${voices.cloneEntries.length}）`">
          <NEmpty v-if="voices.cloneEntries.length === 0" description="还没有复刻音色，去 Step 3 点「复刻新音色」" />
          <NList v-else bordered>
            <NListItem v-for="v in voices.cloneEntries" :key="v.id">
              <NThing>
                <template #header>
                  <NSpace align="center" :size="6">
                    <span>{{ v.alias }}</span>
                    <NTag size="tiny" type="success" :bordered="false">复刻</NTag>
                    <NPopconfirm @positive-click="handleDelete(v)">
                      <template #trigger>
                        <NButton size="small" type="error" quaternary>删除</NButton>
                      </template>
                      确定删除「{{ v.alias }}」？关联的样本音频也会被删除。
                    </NPopconfirm>
                  </NSpace>
                </template>
                <template #description>
                  <span style="font-size: 12px; color: #999;">
                    样本 ID: {{ (v as CloneVoice).sampleAudioId }}
                  </span>
                </template>
              </NThing>
            </NListItem>
          </NList>
        </NTabPane>
      </NTabs>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="emit('update:show', false)">关闭</NButton>
        </NSpace>
      </template>
    </NCard>
  </NModal>
</template>
