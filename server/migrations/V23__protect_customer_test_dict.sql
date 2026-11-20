-- 客户测试字典（是/否）标记为系统预置，配合服务层禁止编辑/删除。
UPDATE dict_items SET preset = true WHERE dict_key = 'customer_test';
