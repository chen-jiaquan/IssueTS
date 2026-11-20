-- 以下权限默认禁止分配：管理员始终拥有全部权限，非管理员不再授予。
UPDATE permissions SET no_assign = true
WHERE code IN ('SECURITY_TAB_SETTINGS','SECURITY_TAB_PERMISSIONS','SECURITY_TAB_ALERTS','DASH_ALERT');

-- 清除非管理员角色对这些权限的历史授权（管理员不受影响）。
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_code = r.code
  AND rp.perm_code IN ('SECURITY_TAB_SETTINGS','SECURITY_TAB_PERMISSIONS','SECURITY_TAB_ALERTS','DASH_ALERT')
  AND NOT (r.code = 'R01' OR r.name = '管理员');
