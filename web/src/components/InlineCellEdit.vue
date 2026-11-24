<script setup>
import { ref, nextTick } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  type: { type: String, default: 'text' },
  options: { type: Array, default: () => [] },
})
const emit = defineEmits(['save', 'cancel'])

const draft = ref(props.modelValue ?? '')
const inputRef = ref(null)

function commit(value) {
  const next = value === null || value === undefined ? '' : value
  if (String(next) === String(props.modelValue ?? '')) emit('cancel')
  else emit('save', next)
}

function onKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commit(draft.value)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('cancel')
  }
}

function onBlur() {
  commit(draft.value)
}

nextTick(() => {
  const el = inputRef.value
  if (!el || typeof el.focus !== 'function') return
  el.focus()
  const input = el.input || el.$el?.querySelector?.('input, textarea')
  if (input && typeof input.select === 'function') input.select()
})
</script>

<template>
  <div class="inline-edit-cell" @click.stop @dblclick.stop>
    <el-select v-if="type === 'select'" ref="inputRef" :model-value="modelValue" filterable clearable
      default-first-option size="small" class="inline-edit-control"
      @change="commit" @visible-change="(v) => !v && emit('cancel')" @keydown.esc.stop="emit('cancel')">
      <el-option v-for="o in options" :key="o" :value="o" :label="o" />
    </el-select>
    <el-date-picker v-else-if="type === 'date'" :model-value="modelValue" type="date"
      value-format="YYYY-MM-DD" size="small" class="inline-edit-control" @change="commit"
      @visible-change="(v) => !v && emit('cancel')" @keydown.esc.stop="emit('cancel')" />
    <el-input-number v-else-if="type === 'number'" ref="inputRef" :model-value="modelValue"
      :controls="false" size="small" class="inline-edit-control" @change="commit"
      @keydown.esc.stop="emit('cancel')" />
    <el-input v-else ref="inputRef" v-model="draft"
      :type="type === 'textarea' ? 'textarea' : 'text'"
      :autosize="type === 'textarea' ? { minRows: 1, maxRows: 4 } : undefined"
      size="small" class="inline-edit-control"
      @keydown="onKeydown" @blur="onBlur" />
  </div>
</template>

<style scoped>
.inline-edit-cell { width: 100%; display: flex; align-items: center; }
.inline-edit-control { width: 100%; }
</style>
