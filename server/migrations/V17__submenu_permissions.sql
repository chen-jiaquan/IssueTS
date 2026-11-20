-- 权限项按界面二级菜单（页签）细化。保留一级总权限作兼容，新增页签级权限。
INSERT INTO permissions (code, module, name, "desc", allow, preset) VALUES
  ('ARCHIVE_TAB_PROJECTS',       '基础档案',   '二级菜单·项目',        '基础档案-项目页签',        jsonb_build_array('管理员', '项目经理'), false),
  ('ARCHIVE_TAB_PRODUCTS',       '基础档案',   '二级菜单·产品',        '基础档案-产品页签',        jsonb_build_array('管理员', '项目经理'), false),
  ('ARCHIVE_TAB_PERSONNEL',      '基础档案',   '二级菜单·人员',        '基础档案-人员页签',        jsonb_build_array('管理员', '项目经理'), false),
  ('ARCHIVE_TAB_DICT',           '基础档案',   '二级菜单·字典',        '基础档案-字典页签',        jsonb_build_array('管理员', '项目经理'), false),
  ('ARCHIVE_TAB_CUSTOM_FIELDS',  '基础档案',   '二级菜单·自定义字段',  '基础档案-自定义字段页签',  jsonb_build_array('管理员', '项目经理'), false),
  ('ARCHIVE_TAB_NOTICE_TYPES',   '基础档案',   '二级菜单·通知类型',    '基础档案-通知类型页签',    jsonb_build_array('管理员', '项目经理'), false),
  ('ARCHIVE_TAB_TODO_PRIOS',     '基础档案',   '二级菜单·待办优先级',  '基础档案-待办优先级页签',  jsonb_build_array('管理员', '项目经理'), false),
  ('ARCHIVE_TAB_REQUIRED_FIELDS','基础档案',   '二级菜单·必填字段',    '基础档案-必填字段页签',    jsonb_build_array('管理员', '项目经理'), false),
  ('SECURITY_TAB_USERS',         '用户与权限', '二级菜单·用户管理',    '用户与权限-用户管理页签',  jsonb_build_array('管理员'), false),
  ('SECURITY_TAB_ROLES',         '用户与权限', '二级菜单·角色',        '用户与权限-角色页签',      jsonb_build_array('管理员', '项目经理'), false),
  ('SECURITY_TAB_PERMISSIONS',   '用户与权限', '二级菜单·权限位',      '用户与权限-权限位页签',    jsonb_build_array('管理员', '项目经理'), false),
  ('SECURITY_TAB_MATRIX',        '用户与权限', '二级菜单·角色权限',    '用户与权限-角色权限页签',  jsonb_build_array('管理员'), false),
  ('SECURITY_TAB_ALERTS',        '用户与权限', '二级菜单·预警规则',    '用户与权限-预警规则页签',  jsonb_build_array('管理员', '项目经理'), false),
  ('SECURITY_TAB_SETTINGS',      '用户与权限', '二级菜单·系统设置',    '用户与权限-系统设置页签',  jsonb_build_array('管理员'), false)
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module, name = EXCLUDED.name, "desc" = EXCLUDED."desc", allow = EXCLUDED.allow;

INSERT INTO role_permissions (role_code, perm_code)
SELECT r.code, v.code
FROM roles r
JOIN (VALUES
  ('ARCHIVE_TAB_PROJECTS',        ARRAY['管理员', '项目经理']),
  ('ARCHIVE_TAB_PRODUCTS',        ARRAY['管理员', '项目经理']),
  ('ARCHIVE_TAB_PERSONNEL',       ARRAY['管理员', '项目经理']),
  ('ARCHIVE_TAB_DICT',            ARRAY['管理员', '项目经理']),
  ('ARCHIVE_TAB_CUSTOM_FIELDS',   ARRAY['管理员', '项目经理']),
  ('ARCHIVE_TAB_NOTICE_TYPES',    ARRAY['管理员', '项目经理']),
  ('ARCHIVE_TAB_TODO_PRIOS',      ARRAY['管理员', '项目经理']),
  ('ARCHIVE_TAB_REQUIRED_FIELDS', ARRAY['管理员', '项目经理']),
  ('SECURITY_TAB_USERS',          ARRAY['管理员']),
  ('SECURITY_TAB_ROLES',          ARRAY['管理员', '项目经理']),
  ('SECURITY_TAB_PERMISSIONS',    ARRAY['管理员', '项目经理']),
  ('SECURITY_TAB_MATRIX',         ARRAY['管理员']),
  ('SECURITY_TAB_ALERTS',         ARRAY['管理员', '项目经理']),
  ('SECURITY_TAB_SETTINGS',       ARRAY['管理员'])
) AS v(code, names) ON r.name = ANY(v.names)
ON CONFLICT (role_code, perm_code) DO NOTHING;
