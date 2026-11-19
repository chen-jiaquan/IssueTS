<script setup>
import { useThemeStore } from '@/store/theme'
import { useBreakpoint } from '@/composables/useBreakpoint'

const theme = useThemeStore()
theme.init()
useBreakpoint()
</script>

<template>
  <el-config-provider>
    <div class="app-shell">
      <router-view />
    </div>
  </el-config-provider>
</template>
