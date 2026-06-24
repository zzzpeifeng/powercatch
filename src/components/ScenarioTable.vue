<template>
  <div class="scenario-table w-full">
    <!-- 场景列表 -->
    <div
      v-for="(scenario, index) in scenarios"
      :key="index"
      class="mb-4 bg-[#2d2d44] rounded-lg overflow-hidden"
    >
      <!-- 场景 Header -->
      <div
        class="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[#3d3d54] transition-colors"
        @click="toggleScenario(index)"
      >
        <div class="flex items-center gap-3">
          <span
            class="scenario-badge px-2 py-1 rounded text-xs font-semibold"
            :class="scenarioBadgeClass(scenario.scenarioType)"
          >
            {{ scenario.scenarioName }}
          </span>
        </div>
        <svg
          class="w-4 h-4 text-gray-400 transition-transform"
          :class="expandedScenarios[index] ? 'rotate-180' : ''"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </div>

      <!-- 场景内容（展开状态） -->
      <div
        v-if="expandedScenarios[index]"
        class="border-t border-gray-700/50"
      >
        <!-- 调用链路 -->
        <div class="px-4 py-3">
          <h4 class="text-xs font-semibold text-gray-400 mb-2">调用链路</h4>
          <div class="space-y-2">
            <div
              v-for="(step, stepIndex) in scenario.callChain"
              :key="stepIndex"
              class="flex items-start gap-3"
            >
              <div class="flex-shrink-0 w-8 h-8 rounded-full bg-[#1a1a2e] flex items-center justify-center text-xs font-bold text-blue-400">
                {{ step.step }}
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-xs font-semibold text-gray-300">{{ step.component }}</span>
                  <span class="text-xs text-gray-500">→</span>
                  <span class="text-xs text-blue-400 font-mono">{{ step.functionName }}</span>
                </div>
                <p class="text-xs text-gray-400">{{ step.description }}</p>
                <p class="text-xs text-gray-500 mt-1 font-mono truncate">{{ step.filePath }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-if="!scenarios || scenarios.length === 0"
      class="text-center py-8 text-gray-500"
    >
      暂无场景数据
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { AnalysisScenario } from '../services/types'

const props = defineProps<{
  scenarios: AnalysisScenario[]
}>()

const expandedScenarios = ref<boolean[]>([])

// 初始化时展开所有场景
onMounted(() => {
  expandedScenarios.value = props.scenarios.map(() => true)
})

function toggleScenario(index: number): void {
  expandedScenarios.value[index] = !expandedScenarios.value[index]
}

function scenarioBadgeClass(type: string): string {
  const classes: Record<string, string> = {
    normal: 'bg-green-900/50 text-green-400',
    'param-error': 'bg-yellow-900/50 text-yellow-400',
    'auth-error': 'bg-red-900/50 text-red-400',
  }
  return classes[type] || 'bg-gray-900/50 text-gray-400'
}
</script>

<style scoped>
.scenario-badge {
  display: inline-block;
  min-width: 80px;
  text-align: center;
}
</style>
