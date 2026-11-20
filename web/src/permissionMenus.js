// 界面二级菜单（页签）权限位，和种子/migration 中的 permissions.code 保持一致。
export const ARCHIVE_TAB_PERM = {
  projects: 'ARCHIVE_TAB_PROJECTS',
  products: 'ARCHIVE_TAB_PRODUCTS',
  personnel: 'ARCHIVE_TAB_PERSONNEL',
  dict: 'ARCHIVE_TAB_DICT',
  custom: 'ARCHIVE_TAB_CUSTOM_FIELDS',
  'notice-types': 'ARCHIVE_TAB_NOTICE_TYPES',
  'todo-prios': 'ARCHIVE_TAB_TODO_PRIOS',
  required: 'ARCHIVE_TAB_REQUIRED_FIELDS',
}

export const SECURITY_TAB_PERM = {
  users: 'SECURITY_TAB_USERS',
  roles: 'SECURITY_TAB_ROLES',
  permissions: 'SECURITY_TAB_PERMISSIONS',
  matrix: 'SECURITY_TAB_MATRIX',
  alerts: 'SECURITY_TAB_ALERTS',
  settings: 'SECURITY_TAB_SETTINGS',
}

export const ARCHIVE_TAB_PERMS = Object.values(ARCHIVE_TAB_PERM)
export const SECURITY_TAB_PERMS = Object.values(SECURITY_TAB_PERM)

// 一级入口：任一二级权限可见即显示入口。
export const ARCHIVE_ENTRY_PERMS = [...ARCHIVE_TAB_PERMS]
export const SECURITY_ENTRY_PERMS = ['DASH_ALERT', ...SECURITY_TAB_PERMS]
