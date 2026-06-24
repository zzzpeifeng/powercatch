/**
 * Vue Router 路由配置
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Main',
    component: () => import('../views/MainView.vue'),
  },
  {
    path: '/ai-analysis',
    name: 'AiAnalysis',
    component: () => import('../views/AiAnalysisView.vue'),
  },
  // 新增：AI 分析进度页面
  {
    path: '/ai-analysis/progress',
    name: 'AiAnalysisProgress',
    component: () => import('../views/AiAnalysisProgressView.vue'),
  },
  // 新增：AI 分析结果页面
  {
    path: '/ai-analysis/result',
    name: 'AiAnalysisResult',
    component: () => import('../views/AiAnalysisResultView.vue'),
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/SettingsView.vue'),
  },
  {
    path: '/ssl-errors',
    name: 'SslErrors',
    component: () => import('../views/SslErrorView.vue'),
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
