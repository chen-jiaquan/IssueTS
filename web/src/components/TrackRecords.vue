<script setup>
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Calendar } from '@element-plus/icons-vue'
import { useAuthStore } from '@/store/auth'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  editable: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue'])
const auth = useAuthStore()

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const draft = reactive({ date: todayStr(), text: '', by: auth.user?.person || '' })
const editIndex = ref(-1)

function resetDraft() {
  draft.date = todayStr()
  draft.text = ''
  draft.by = auth.user?.person || ''
  editIndex.value = -1
}
resetDraft()

function commit(next) {
  emit('update:modelValue', next)
}
function addRecord() {
  const text = String(draft.text || '').trim()
  if (!text) return ElMessage.warning('请填写跟踪记录内容')
  const rec = { date: draft.date || todayStr(), text, by: draft.by || '' }
  const list = Array.isArray(props.modelValue) ? [...props.modelValue] : []
  if (editIndex.value >= 0) {
    list.splice(editIndex.value, 1, rec)
    ElMessage.success('跟踪记录已修改')
  } else {
    list.push(rec)
  }
  commit(list)
  resetDraft()
}
function editRecord(i) {
  const r = props.modelValue[i]
  if (!r) return
  draft.date = r.date || todayStr()
  draft.text = r.text || ''
  draft.by = r.by || ''
  editIndex.value = i
}
function removeRecord(i) {
  const list = [...props.modelValue]
  list.splice(i, 1)
  commit(list)
  if (editIndex.value === i) resetDraft()
  else if (editIndex.value > i) editIndex.value--
}
function cancelEdit() {
  resetDraft()
}
</script>

<template>
  <div class="track-box">
    <div v-if="(modelValue || []).length" class="track-timeline">
      <div v-for="(t, i) in modelValue" :key="i" class="track-entry">
        <span class="track-node"></span>
        <div class="track-entry-body">
          <span class="track-entry-date">{{ t.date }}</span>
          <span class="track-entry-text">{{ t.text }}</span>
          <span v-if="t.by" class="track-entry-by">— {{ t.by }}</span>
          <template v-if="editable">
            <el-button link type="primary" size="small" @click="editRecord(i)">修改</el-button>
            <el-button link type="danger" size="small" @click="removeRecord(i)">删除</el-button>
          </template>
        </div>
      </div>
    </div>
    <div v-else class="track-empty">暂无跟踪记录，可在下方添加</div>
    <div v-if="editable" class="track-add">
      <el-input v-model="draft.date" class="track-date" readonly>
        <template #prefix><el-icon><Calendar /></el-icon></template>
      </el-input>
      <el-input v-model="draft.text" class="track-text" :placeholder="editIndex >= 0 ? '修改本次跟踪记录...' : '填写本次跟踪记录...'"
        @keyup.enter="addRecord" />
      <el-input v-model="draft.by" class="track-by" readonly />
      <el-button type="primary" @click="addRecord">{{ editIndex >= 0 ? '保存修改' : '添加记录' }}</el-button>
      <el-button v-if="editIndex >= 0" @click="cancelEdit">取消修改</el-button>
    </div>
  </div>
</template>

<style scoped>
.track-box { width: 100%; }
.track-timeline { border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 12px 12px 4px; margin-bottom: 10px; background: var(--el-fill-color-lighter); }
.track-entry { position: relative; padding: 0 0 12px 18px; }
.track-entry::before { content: ''; position: absolute; left: 4px; top: 12px; bottom: -2px; width: 1px; background: var(--el-border-color); }
.track-entry:last-child::before { display: none; }
.track-node { position: absolute; left: 0; top: 4px; width: 9px; height: 9px; border-radius: 50%; background: var(--el-color-primary); box-shadow: 0 0 0 3px var(--el-color-primary-light-9); }
.track-entry-body { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 20px; }
.track-entry-date { font-weight: 600; color: var(--el-color-primary); font-variant-numeric: tabular-nums; }
.track-entry-text { color: var(--el-text-color-primary); }
.track-entry-by { color: var(--el-text-color-secondary); font-size: 12px; }
.track-empty { color: var(--el-text-color-placeholder); font-size: 12px; padding: 4px 0 10px; }
.track-add { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.track-add .track-date { width: 150px; flex: 0 0 150px; }
.track-add .track-text { flex: 1 1 220px; }
.track-add .track-by { width: 110px; flex: 0 0 110px; }
</style>
