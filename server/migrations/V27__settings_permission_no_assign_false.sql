-- 系统设置页签权限恢复为可分配（禁止分配=否）。
UPDATE permissions
SET no_assign = false
WHERE code = 'SECURITY_TAB_SETTINGS';

-- 恢复此前自测清理时被移除的项目经理授权，避免已设置过的权限再次丢失。
INSERT INTO role_permissions(role_code, perm_code)
SELECT 'R02', 'SECURITY_TAB_SETTINGS'
WHERE EXISTS (SELECT 1 FROM roles WHERE code = 'R02')
  AND EXISTS (SELECT 1 FROM permissions WHERE code = 'SECURITY_TAB_SETTINGS')
ON CONFLICT DO NOTHING;
