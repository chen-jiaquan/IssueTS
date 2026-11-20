-- 一级总权限 ARCHIVE_MGR / SECURITY_MGR 与二级菜单权限重复，删除权限位记录。
-- role_permissions.perm_code 有 ON DELETE CASCADE，对应授权会自动清理。
DELETE FROM permissions WHERE code IN ('ARCHIVE_MGR', 'SECURITY_MGR');
