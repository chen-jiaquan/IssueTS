-- 优先级、状态、待测试（含客户测试）字典标记为系统预置，配合服务层禁止编辑/删除。
UPDATE dict_items SET preset = true
WHERE dict_key IN ('priority', 'status', 'pending_test', 'customer_test');
