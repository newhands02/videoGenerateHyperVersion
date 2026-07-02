import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/Home.vue'),
  },
  {
    path: '/step/1',
    name: 'step1',
    component: () => import('@/views/Step1Input.vue'),
    meta: { title: '输入文案', step: 1 },
  },
  {
    path: '/step/2',
    name: 'step2',
    component: () => import('@/views/Step2Script.vue'),
    meta: { title: '脚本分段', step: 2 },
  },
  {
    path: '/step/3',
    name: 'step3',
    component: () => import('@/views/Step3Scenes.vue'),
    meta: { title: '配场景', step: 3 },
  },
  {
    path: '/step/4',
    name: 'step4',
    component: () => import('@/views/Step4Timeline.vue'),
    meta: { title: '时间轴', step: 4 },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
