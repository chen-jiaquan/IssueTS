-- 内置角色 R01~R05 标记为系统预置，配合服务层禁止编辑/删除。
UPDATE roles SET preset = true WHERE code IN ('R01','R02','R03','R04','R05');
