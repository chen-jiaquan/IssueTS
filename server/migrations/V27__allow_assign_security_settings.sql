-- 系统设置页签权限允许分配给角色，兼容此前已应用 V24 的环境。
UPDATE permissions SET no_assign = false WHERE code = 'SECURITY_TAB_SETTINGS';
