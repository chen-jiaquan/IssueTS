<script setup>
// 通用多选控件：下拉面板内以复选框勾选，统一后续多选交互
import { computed, ref } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  options: { type: Array, default: () => [] }, // 支持 '值' 或 { value, label }
  placeholder: { type: String, default: '请选择' },
  width: { type: String, default: '100%' },
  popoverWidth: { type: [String, Number], default: 280 },
  disabled: { type: Boolean, default: false },
  filterable: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'change'])

const visible = ref(false)
const keyword = ref('')
const normalized = computed(() => props.options.map((o) => (
  o && typeof o === 'object'
    ? { value: o.value, label: o.label ?? String(o.value) }
    : { value: o, label: String(o) }
)))
const filtered = computed(() => normalized.value.filter((o) =>
  !keyword.value || String(o.label).toLowerCase().includes(keyword.value.toLowerCase())))
const labelOf = (v) => normalized.value.find((o) => o.value === v)?.label ?? String(v)
const display = computed(() => props.modelValue.length
  ? props.modelValue.map(labelOf).join('、')
  : props.placeholder)

function update(values) {
  emit('update:modelValue', values)
  emit('change', values)
}
function clear() { update([]) }
</script>

<template>
  <el-popover v-model:visible="visible" placement="bottom-start" trigger="click"
    :width="popoverWidth" :disabled="disabled" popper-class="multi-checkbox-popper">
    <template #reference>
      <div class="mcs" :class="{ 'is-disabled': disabled, 'is-placeholder': !modelValue.length }"
        :style="{ width }" :title="display">
        <span class="mcs-text">{{ display }}</span>
        <span v-if="modelValue.length" class="mcs-count">{{ modelValue.length }}</span>
        <el-icon class="mcs-arrow"><ArrowDown /></el-icon>
      </div>
    </template>
    <div class="mcs-panel">
      <el-input v-if="filterable" v-model="keyword" size="small" clearable placeholder="搜索" />
      <div class="mcs-options">
        <el-checkbox-group :model-value="modelValue" @update:model-value="update" class="mcs-list">
          <el-checkbox v-for="o in filtered" :key="o.value" :value="o.value">{{ o.label }}</el-checkbox>
        </el-checkbox-group>
        <div v-if="!filtered.length" class="mcs-empty">无匹配项</div>
      </div>
      <div class="mcs-ops">
        <el-button link size="small" @click="clear">清空</el-button>
        <el-button link size="small" type="primary" @click="visible = false">完成</el-button>
      </div>
    </div>
  </el-popover>
</template>

<style scoped>
.mcs { display: flex; align-items: center; gap: 4px; box-sizing: border-box; min-height: 32px; padding: 0 8px; border: 1px solid var(--el-border-color); border-radius: var(--el-border-radius-base); background: var(--el-bg-color); cursor: pointer; }
.mcs:hover { border-color: var(--el-color-primary); }
.mcs.is-disabled { cursor: not-allowed; background: var(--el-fill-color-light); color: var(--el-text-color-disabled); }
.mcs.is-placeholder .mcs-text { color: var(--el-text-color-placeholder); }
.mcs-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--el-text-color-regular); }
.mcs-count { font-size: 11px; color: var(--el-color-primary); background: var(--el-color-primary-light-9); border-radius: 8px; padding: 0 5px; }
.mcs-arrow { font-size: 12px; color: var(--el-text-color-secondary); }
.mcs-panel { display: flex; flex-direction: column; gap: 6px; }
.mcs-options { max-height: 240px; overflow-y: auto; }
.mcs-list { display: flex; flex-direction: column; gap: 2px; }
.mcs-list :deep(.el-checkbox) { height: 26px; margin-right: 0; }
.mcs-empty { font-size: 12px; color: var(--el-text-color-secondary); padding: 8px 0; }
.mcs-ops { display: flex; justify-content: space-between; border-top: 1px solid var(--el-border-color-lighter); padding-top: 4px; }
</style>
