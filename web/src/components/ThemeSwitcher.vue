<script setup>
// 界面配色切换器（三套主题，本地记忆，见 docs/问题跟踪系统_页面原型.html 交互）
import { useThemeStore } from '@/store/theme'

const theme = useThemeStore()

const THEMES = [
  { key: 'ocean', name: '深空蓝', desc: '沉稳深色 · 长时间盯屏', swatch: ['#111820', '#202a35', '#5aa2ff'] },
  { key: 'paper', name: '云白', desc: '明亮浅色 · 投屏与打印', swatch: ['#f4f7fb', '#eef3f9', '#2563eb'] },
  { key: 'warm', name: '暖砂', desc: '柔和暖色 · 阅读与汇报', swatch: ['#f7f3ec', '#efe6d6', '#a9551f'] },
]
</script>

<template>
  <el-popover trigger="click" width="230">
    <template #reference>
      <el-button size="small">主题</el-button>
    </template>
    <div class="opts">
      <button v-for="t in THEMES" :key="t.key" type="button" class="opt" :class="{ on: theme.current === t.key }"
        @click="theme.set(t.key)">
        <span class="swatch"><i :style="{ background: t.swatch[0] }" /><i :style="{ background: t.swatch[1] }" /><i :style="{ background: t.swatch[2] }" /></span>
        <span class="txt"><b>{{ t.name }}</b><small>{{ t.desc }}</small></span>
        <span class="check">✓</span>
      </button>
    </div>
  </el-popover>
</template>

<style scoped>
.opts { display: flex; flex-direction: column; gap: 6px; }
.opt { display: flex; align-items: center; gap: 10px; width: 100%; border: 1px solid var(--border); background: var(--surface);
  border-radius: 7px; padding: 7px 10px; cursor: pointer; text-align: left; color: var(--text); }
.opt.on { border-color: var(--accent); background: rgba(var(--accent-rgb, 59, 130, 246), .10); box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb, 59, 130, 246), .25); }
.swatch { display: inline-flex; width: 34px; height: 24px; border-radius: 5px; overflow: hidden; border: 1px solid var(--border); flex: none; }
.swatch i { flex: 1; }
.txt { display: flex; flex-direction: column; line-height: 1.35; }
.txt b { font-size: 12.5px; font-weight: 600; }
.txt small { font-size: 10.5px; color: var(--muted); }
.check { margin-left: auto; color: var(--accent); font-size: 14px; opacity: 0; }
.opt.on .check { opacity: 1; }
</style>
