<script setup lang="ts">
import { computed, h } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider, NLayout, NLayoutHeader, NLayoutSider, NLayoutContent, NMenu, NIcon, NSpace, NText } from 'naive-ui';
import type { MenuOption } from 'naive-ui';

const route = useRoute();
const router = useRouter();

/** 菜单 key → 路由路径 */
const keyToPath: Record<string, string> = {
  home: '/',
  step1: '/step/1',
  step2: '/step/2',
  step3: '/step/3',
  step4: '/step/4',
};

/** 路由 name → 菜单 key */
const routeNameToKey: Record<string, string> = {
  home: 'home',
  step1: 'step1',
  step2: 'step2',
  step3: 'step3',
  step4: 'step4',
};

const menuOptions = computed<MenuOption[]>(() => [
  { label: () => h('span', '🏠 首页'), key: 'home' },
  { label: () => h('span', '① 输入文案'), key: 'step1' },
  { label: () => h('span', '② 脚本分段'), key: 'step2' },
  { label: () => h('span', '③ 配场景'), key: 'step3' },
  { label: () => h('span', '④ 时间轴'), key: 'step4' },
]);

const activeKey = computed(() => routeNameToKey[route.name as string] ?? 'home');

/** 菜单点击跳转 */
function handleMenuSelect(key: string) {
  const path = keyToPath[key];
  if (path) router.push(path);
}
</script>

<template>
  <NConfigProvider>
    <NMessageProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <NLayout style="height: 100vh" has-sider>
            <NLayoutSider
              bordered
              :width="220"
              :native-scrollbar="false"
              content-style="padding: 12px;"
            >
              <div class="logo">
                <span class="logo-mark">W</span>
                <span class="logo-text">WebFrames</span>
              </div>
              <NMenu :value="activeKey" :options="menuOptions" :indent="18" @update:value="handleMenuSelect" />
            </NLayoutSider>
            <NLayout>
              <NLayoutHeader bordered class="topbar">
                <NSpace align="center" :wrap="false">
                  <NText depth="3">v0.1.3 · Phase A</NText>
                  <span style="flex: 1" />
                  <NText depth="3" :code="true">{{ activeKey }}</NText>
                </NSpace>
              </NLayoutHeader>
              <NLayoutContent class="content">
                <RouterView />
              </NLayoutContent>
            </NLayout>
          </NLayout>
        </NNotificationProvider>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped>
.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 16px 4px;
  border-bottom: 1px solid var(--n-border-color);
  margin-bottom: 12px;
}
.logo-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--n-color-primary, #18a058);
  color: white;
  font-weight: 700;
  font-size: 16px;
}
.logo-text {
  font-weight: 600;
  font-size: 16px;
  color: var(--n-text-color);
}
.topbar {
  height: 48px;
  padding: 0 20px;
  display: flex;
  align-items: center;
}
.content {
  padding: 24px;
  background: var(--n-body-color);
}
</style>
