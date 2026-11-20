-- 内置 admin 账号标记为系统预置，配合服务层禁止删除/停用。
UPDATE users SET preset = true WHERE username = 'admin';
