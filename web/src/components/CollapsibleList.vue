<script setup>
// 通用折叠列表：默认只展示前 limit 条，点箭头展开全部
import { computed, ref, watch } from 'vue'
import { ArrowDown, ArrowUp } from '@element-plus/icons-vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  limit: { type: Number, default: 6 },
  emptyText: { type: String, default: '暂无数据' },
})
const expanded = ref(false)
watch(() => props.items.length, () => { expanded.value = false })
const visibleItems = computed(() => (expanded.value ? props.items : props.items.slice(0, props.limit)))
const restCount = computed(() => Math.max(0, props.items.length - props.limit))
</script>

<template>
  <div class="collapsible-list">
    <slot v-for="(item, index) in visibleItems" name="item" :item="item" :index="index" />
    <div v-if="!items.length" class="cl-empty">{{ emptyText }}</div>
    <div v-if="restCount > 0" class="cl-more" @click="expanded = !expanded">
      <span>{{ expanded ? '收起' : `展开剩余 ${restCount} 条` }}</span>
      <el-icon><ArrowUp v-if="expanded" /><ArrowDown v-else /></el-icon>
    </div>
  </div>
</template>

<style scoped>
.cl-empty { color: var(--el-text-color-disabled); font-size: 13px; padding: 12px 0; }
.cl-more { display: flex; align-items: center; justify-content: center; gap: 4px; padding: 8px 0 2px; font-size: 12px; color: var(--el-color-primary); cursor: pointer; user-select: none; }
.cl-more:hover { text-decoration: underline; }
</style>
