<script setup>
// 基础档案设置：项目/产品/人员/字典/自定义字段/必填/通知类型/待办优先级/预警规则/角色 编辑
// 权限：读=登录即可；写=ARCHIVE_MGR（预警规则=DASH_ALERT）；角色权限矩阵在「用户与权限」页维护
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import BackHome from '@/components/BackHome.vue'
import { useAuthStore } from '@/store/auth'
import * as A from '@/api/archives'
import http from '@/api/http'

const auth = useAuthStore()
const canWrite = auth.has('ARCHIVE_MGR')
const canAlert = auth.has('DASH_ALERT')

const tab = ref('projects')
const loading = ref(false)

// ---------- 数据 ----------
const projects = ref([])
const products = ref([])
const personnel = ref([])
const dictItems = ref([])
const dictFilter = ref('')
const customFields = ref([])
const requiredFields = ref([])
const fieldOptions = ref([]) // 问题字段清单（供必填勾选）
const noticeTypes = ref([])
const todoPrios = ref([])
const alertRules = ref([])
const roles = ref([])
const perms = ref([])

const DICT_KEYS = [
  { key: 'project', label: '项目状态' }, { key: 'stage', label: '阶段' }, { key: 'type', label: '类型' },
  { key: 'module', label: '模块' }, { key: 'priority', label: '优先级' }, { key: 'impact', label: '影响程度' },
  { key: 'status', label: '状态' }, { key: 'pending_test', label: '待测试' }, { key: 'customer_test', label: '客户测试' },
]
const dictLabel = (k) => DICT_KEYS.find((d) => d.key === k)?.label ?? k

async function loadAll() {
  loading.value = true
  try {
    const [cfg, req] = await Promise.all([http.get('/config/fields'), A.getRequiredFields()])
    fieldOptions.value = cfg.fields.filter((f) => !['track', 'custom_fields', 'image_url'].includes(f.key))
    requiredFields.value = req
    // 登录即可读的档案
    const done = await Promise.all([
      A.listProjects(), A.listProducts(), A.listPersonnel(), A.listDictItems(),
      A.listCustomFields(), A.listNoticeTypes(), A.listTodoPrios(),
    ])
    ;[projects.value, products.value, personnel.value, dictItems.value,
      customFields.value, noticeTypes.value, todoPrios.value] = done
    // 管理员专属：角色/权限位/预警规则
    if (canWrite) {
      ;[roles.value, perms.value] = await Promise.all([A.listRoles(), http.get('/archives/permissions')])
    }
    if (canAlert) alertRules.value = await A.listAlertRules()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
onMounted(loadAll)

// ---------- 通用编辑对话框 ----------
const dialog = ref(false)
const editing = ref(null) // 当前编辑行（null=新增）
const cfg = ref(null) // 当前 tab 配置
const form = reactive({})
const saving = ref(false)

function openDialog(tabCfg, row = null) {
  cfg.value = tabCfg
  editing.value = row
  Object.keys(form).forEach((k) => delete form[k])
  for (const f of tabCfg.form) {
    form[f.key] = row ? (row[f.key] ?? f.default ?? '') : (f.default ?? '')
    if (f.type === 'switch' && row) form[f.key] = !!row[f.key]
  }
  dialog.value = true
}

async function saveDialog() {
  for (const f of cfg.value.form) {
    if (f.required && !editing.value && (form[f.key] === '' || form[f.key] == null)) {
      return ElMessage.warning(`${f.label} 必填`)
    }
  }
  const payload = {}
  for (const f of cfg.value.form) payload[f.key] = form[f.key] === '' ? null : form[f.key]
  saving.value = true
  try {
    if (editing.value) await cfg.value.api.update(editing.value, payload)
    else await cfg.value.api.create(payload)
    ElMessage.success('已保存')
    dialog.value = false
    await cfg.value.reload()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

async function removeRow(tabCfg, row) {
  await ElMessageBox.confirm(`确认删除「${row[tabCfg.nameKey] ?? row[tabCfg.rowKey]}」？删除不可恢复。`, '删除', { type: 'warning' })
  try {
    await tabCfg.api.del(row)
    ElMessage.success('已删除')
    await tabCfg.reload()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// ---------- 各档案配置 ----------
const colorCell = (key) => ({
  key, label: '颜色', width: 90,
  render: (row) => (row[key] ? { color: row[key] } : null),
})

const projectCfg = computed(() => ({
  rowKey: 'code', nameKey: 'name',
  rows: projects.value, reload: async () => { projects.value = await A.listProjects() },
  cols: [
    { key: 'code', label: '编码', width: 130 }, { key: 'name', label: '名称', width: 200 },
    { key: 'note', label: '备注' }, colorCell('color'),
  ],
  form: [
    { key: 'code', label: '编码', required: true, disabledOnEdit: true },
    { key: 'name', label: '名称' }, { key: 'note', label: '备注', type: 'textarea' },
    { key: 'color', label: '颜色', type: 'color' },
  ],
  api: { create: A.createProject, update: (row, d) => A.updateProject(row.code, d), del: (row) => A.deleteProject(row.code) },
}))

const productCfg = computed(() => ({
  rowKey: 'code', nameKey: 'code',
  rows: products.value, reload: async () => { products.value = await A.listProducts() },
  cols: [{ key: 'code', label: '编码', width: 130 }, { key: 'note', label: '备注' }, colorCell('color')],
  form: [
    { key: 'code', label: '编码', required: true, disabledOnEdit: true },
    { key: 'note', label: '备注', type: 'textarea' }, { key: 'color', label: '颜色', type: 'color' },
  ],
  api: { create: A.createProduct, update: (row, d) => A.updateProduct(row.code, d), del: (row) => A.deleteProduct(row.code) },
}))

const personnelCfg = computed(() => ({
  rowKey: 'code', nameKey: 'name',
  rows: personnel.value, reload: async () => { personnel.value = await A.listPersonnel() },
  cols: [
    { key: 'code', label: '编码', width: 110 }, { key: 'name', label: '姓名', width: 130 },
    { key: 'role', label: '岗位', width: 130 }, { key: 'group', label: '所属组' }, colorCell('color'),
  ],
  form: [
    { key: 'code', label: '编码', required: true, disabledOnEdit: true },
    { key: 'name', label: '姓名', required: true },
    { key: 'role', label: '岗位' }, { key: 'group', label: '所属组' },
    { key: 'color', label: '颜色', type: 'color' },
  ],
  api: { create: A.createPersonnel, update: (row, d) => A.updatePersonnel(row.code, d), del: (row) => A.deletePersonnel(row.code) },
}))

const dictFiltered = computed(() =>
  dictItems.value.filter((d) => !dictFilter.value || d.dict_key === dictFilter.value))
const dictCfg = computed(() => ({
  rowKey: 'id', nameKey: 'value',
  rows: dictFiltered.value, reload: async () => { dictItems.value = await A.listDictItems() },
  cols: [
    { key: 'dict_key', label: '字典', width: 110, render: (row) => ({ text: dictLabel(row.dict_key) }) },
    { key: 'value', label: '值', width: 120 }, { key: 'label', label: '显示名', width: 140 },
    { key: 'product_code', label: '所属产品', width: 110 },
    { key: 'note', label: '备注' }, { key: 'sort', label: '排序', width: 70 }, colorCell('color'),
  ],
  form: [
    { key: 'dict_key', label: '字典', type: 'select', options: DICT_KEYS, required: true, disabledOnEdit: true },
    { key: 'value', label: '值', required: true },
    { key: 'label', label: '显示名' },
    { key: 'product_code', label: '所属产品', type: 'select', options: () => products.value.map((p) => ({ key: p.code, label: p.code })), showIf: (f) => form.dict_key === 'module' },
    { key: 'note', label: '备注', type: 'textarea' },
    { key: 'sort', label: '排序', type: 'number', default: 0 },
    { key: 'color', label: '颜色', type: 'color' },
  ],
  api: { create: A.createDictItem, update: (row, d) => A.updateDictItem(row.id, d), del: (row) => A.deleteDictItem(row.id) },
}))

const customCfg = computed(() => ({
  rowKey: 'key', nameKey: 'label',
  rows: customFields.value, reload: async () => { customFields.value = await A.listCustomFields() },
  cols: [
    { key: 'key', label: '字段键', width: 130 }, { key: 'label', label: '列名', width: 180 },
    { key: 'type', label: '类型', width: 120, render: (row) => ({ text: { text: '单行', textarea: '多行', number: '数字', date: '日期' }[row.type] }) },
  ],
  form: [
    { key: 'key', label: '字段键', required: true, disabledOnEdit: true, default: `cf_${customFields.value.length + 1}` },
    { key: 'label', label: '列名', required: true },
    { key: 'type', label: '类型', type: 'select', required: true, default: 'text',
      options: [{ key: 'text', label: '单行' }, { key: 'textarea', label: '多行' }, { key: 'number', label: '数字' }, { key: 'date', label: '日期' }] },
  ],
  api: { create: A.createCustomField, update: (row, d) => A.updateCustomField(row.key, d), del: (row) => A.deleteCustomField(row.key) },
}))

const noticeTypeCfg = computed(() => ({
  rowKey: 'id', nameKey: 'name',
  rows: noticeTypes.value, reload: async () => { noticeTypes.value = await A.listNoticeTypes() },
  cols: [{ key: 'id', label: 'ID', width: 80 }, { key: 'name', label: '类型名', width: 220 }],
  form: [{ key: 'name', label: '类型名', required: true }],
  api: { create: A.createNoticeType, update: (row, d) => A.updateNoticeType(row.id, d.name), del: (row) => A.deleteNoticeType(row.id) },
}))

const todoPrioCfg = computed(() => ({
  rowKey: 'code', nameKey: 'code',
  rows: todoPrios.value, reload: async () => { todoPrios.value = await A.listTodoPrios() },
  cols: [{ key: 'code', label: '编码', width: 100 }, { key: 'label', label: '说明', width: 260 }],
  form: [
    { key: 'code', label: '编码', type: 'select', required: true, disabledOnEdit: true,
      options: [{ key: 'C', label: 'C 关键' }, { key: 'H', label: 'H 高' }, { key: 'M', label: 'M 中' }, { key: 'L', label: 'L 低' }] },
    { key: 'label', label: '说明' },
  ],
  api: { create: A.createTodoPrio, update: (row, d) => A.updateTodoPrio(row.code, d), del: (row) => A.deleteTodoPrio(row.code) },
}))

const roleCfg = computed(() => ({
  rowKey: 'code', nameKey: 'name',
  rows: roles.value, reload: async () => { roles.value = await A.listRoles() },
  cols: [
    { key: 'code', label: '编码', width: 100 }, { key: 'name', label: '角色名', width: 140 },
    { key: 'desc', label: '描述' },
    { key: 'external', label: '外部角色', width: 100, render: (row) => ({ text: row.external ? '是' : '否' }) },
    colorCell('color'),
  ],
  form: [
    { key: 'code', label: '编码', required: true, disabledOnEdit: true },
    { key: 'name', label: '角色名', required: true },
    { key: 'desc', label: '描述', type: 'textarea' },
    { key: 'external', label: '外部角色', type: 'switch' },
    { key: 'color', label: '颜色', type: 'color' },
  ],
  api: { create: A.createRole, update: (row, d) => A.updateRole(row.code, d), del: (row) => A.deleteRole(row.code) },
}))

// 各 tab 配置（解包 computed，供模板 v-for 使用）
// 各 tab 配置（解包 computed；角色 tab 仅 ARCHIVE_MGR 可见）
const CFGS = computed(() => {
  const map = {
    projects: projectCfg.value, products: productCfg.value, personnel: personnelCfg.value,
    dict: dictCfg.value, custom: customCfg.value, 'notice-types': noticeTypeCfg.value,
    'todo-prios': todoPrioCfg.value,
  }
  if (canWrite) map.roles = roleCfg.value
  return map
})

// ---------- 预警规则（行内编辑） ----------
async function saveAlertRule(row) {
  try {
    await A.putAlertRule({ key: row.key, enabled: !!row.enabled, days: row.days === '' ? null : Number(row.days) })
    ElMessage.success(`规则「${row.label}」已保存`)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// ---------- 必填字段 ----------
const reqDirty = ref(false)
function toggleRequired(key, checked) {
  if (checked) requiredFields.value.push(key)
  else requiredFields.value = requiredFields.value.filter((f) => f !== key)
  reqDirty.value = true
}
async function saveRequired() {
  try {
    await A.putRequiredFields(requiredFields.value)
    ElMessage.success('必填字段配置已保存')
    reqDirty.value = false
  } catch (e) {
    ElMessage.error(e.message)
  }
}

const fieldLabelOf = (key) => fieldOptions.value.find((f) => f.key === key)?.label ?? key
</script>

<template>
  <div style="padding: 14px 20px 30px">
    <div class="hd">
      <BackHome />
      <h2 style="margin:0">基础档案设置</h2>
      <el-alert v-if="!canWrite" type="info" :closable="false" style="padding:4px 12px"
        title="当前账号为只读查看；如需维护档案请联系管理员" />
    </div>

    <el-tabs v-model="tab" v-loading="loading" style="margin-top:10px">
      <!-- 通用表格型档案 -->
      <el-tab-pane v-for="(c, key) in CFGS" :key="key" :label="{ projects: '项目', products: '产品', personnel: '人员', dict: '字典', custom: '自定义字段', 'notice-types': '通知类型', 'todo-prios': '待办优先级', roles: '角色' }[key]" :name="key">
        <div class="toolbar">
          <el-select v-if="key === 'dict'" v-model="dictFilter" clearable placeholder="按字典类型过滤" style="width:180px">
            <el-option v-for="d in DICT_KEYS" :key="d.key" :value="d.key" :label="d.label" />
          </el-select>
          <el-button v-if="canWrite" type="primary" size="small" @click="openDialog(c)">新增</el-button>
          <span v-if="key === 'roles'" class="tip">角色权限分配在「用户与权限」页维护</span>
        </div>
        <el-table :data="c.rows" size="small" border stripe>
          <el-table-column v-for="col in c.cols" :key="col.key" :prop="col.key" :label="col.label" :width="col.width">
            <template #default="{ row }">
              <el-tag v-if="col.render && col.render(row)?.color" size="small"
                :style="{ color: col.render(row).color, borderColor: col.render(row).color, backgroundColor: col.render(row).color + '22' }">
                {{ col.render(row).text ?? row[col.key] }}
              </el-tag>
              <span v-else-if="col.render">{{ col.render(row)?.text ?? row[col.key] }}</span>
              <span v-else>{{ row[col.key] ?? '' }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="canWrite" label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button link size="small" type="primary" @click="openDialog(c, row)">编辑</el-button>
              <el-button link size="small" type="danger" @click="removeRow(c, row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 必填字段 -->
      <el-tab-pane label="必填字段" name="required">
        <div class="toolbar">
          <span class="tip">登记/编辑问题时的必填项；默认 project/desc/priority/status</span>
          <el-button v-if="canWrite" type="primary" size="small" :disabled="!reqDirty" @click="saveRequired">保存配置</el-button>
        </div>
        <el-checkbox-group style="display:flex; flex-wrap:wrap; gap:6px 18px">
          <el-checkbox v-for="f in fieldOptions" :key="f.key"
            :model-value="requiredFields.includes(f.key)" :disabled="!canWrite"
            @change="(v) => toggleRequired(f.key, v)">{{ f.key }} {{ f.label }}</el-checkbox>
        </el-checkbox-group>
      </el-tab-pane>

      <!-- 预警规则 -->
      <el-tab-pane v-if="canAlert" label="预警规则" name="alerts">
        <div class="toolbar"><span class="tip">启用后规则在首页工作台「预警事项」实时生效；custTest 的天数为已解决后未完成客户测试的容忍天数</span></div>
        <el-table :data="alertRules" size="small" border>
          <el-table-column prop="key" label="规则键" width="120" />
          <el-table-column prop="label" label="说明" min-width="240" />
          <el-table-column label="启用" width="80">
            <template #default="{ row }"><el-switch v-model="row.enabled" :disabled="!canAlert" @change="saveAlertRule(row)" /></template>
          </el-table-column>
          <el-table-column label="阈值(天)" width="130">
            <template #default="{ row }">
              <el-input-number v-if="row.key === 'custTest'" v-model="row.days" :min="1" :max="90" size="small"
                :disabled="!canAlert" @change="saveAlertRule(row)" />
              <span v-else class="tip">—</span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 权限位（只读，ARCHIVE_MGR） -->
      <el-tab-pane v-if="canWrite" label="权限位" name="perms">
        <div class="toolbar"><span class="tip">权限分配矩阵在「用户与权限」页维护</span></div>
        <el-table :data="perms" size="small" border stripe>
          <el-table-column prop="code" label="编码" width="150" />
          <el-table-column prop="module" label="模块" width="120" />
          <el-table-column prop="name" label="名称" width="200" />
          <el-table-column prop="desc" label="描述" />
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 通用编辑对话框 -->
    <el-dialog v-model="dialog" :title="(editing ? '编辑' : '新增') + ({ projects: '项目', products: '产品', personnel: '人员', dict: '字典项', custom: '自定义字段', 'notice-types': '通知类型', 'todo-prios': '待办优先级', roles: '角色' }[tab] ?? '')" width="480px">
      <el-form label-width="90px">
        <template v-for="f in cfg?.form ?? []" :key="f.key">
          <el-form-item v-if="!f.showIf || f.showIf(f)" :label="f.label" :required="f.required && !editing">
            <el-color-picker v-if="f.type === 'color'" v-model="form[f.key]" />
            <el-switch v-else-if="f.type === 'switch'" v-model="form[f.key]" />
            <el-input-number v-else-if="f.type === 'number'" v-model="form[f.key]" style="width:100%" />
            <el-select v-else-if="f.type === 'select'" v-model="form[f.key]" style="width:100%" :disabled="f.disabledOnEdit && !!editing">
              <el-option v-for="o in (typeof f.options === 'function' ? f.options() : f.options)" :key="o.key" :value="o.key" :label="o.label" />
            </el-select>
            <el-input v-else-if="f.type === 'textarea'" v-model="form[f.key]" type="textarea" :rows="2" />
            <el-input v-else v-model="form[f.key]" :disabled="f.disabledOnEdit && !!editing" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveDialog">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.hd { display: flex; align-items: center; gap: 16px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.tip { font-size: 12px; color: var(--el-text-color-secondary); }
</style>
