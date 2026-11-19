-- 档案增加多选项目（空数组表示通用/全局）；必填规则增加项目维度
ALTER TABLE products      ADD COLUMN IF NOT EXISTS projects text[] NOT NULL DEFAULT '{}';
ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS projects text[] NOT NULL DEFAULT '{}';
ALTER TABLE notice_types  ADD COLUMN IF NOT EXISTS projects text[] NOT NULL DEFAULT '{}';
ALTER TABLE todo_prios    ADD COLUMN IF NOT EXISTS projects text[] NOT NULL DEFAULT '{}';
ALTER TABLE required_fields ADD COLUMN IF NOT EXISTS projects text[] NOT NULL DEFAULT '{}';

-- 待办优先级/通知类型的存量通用数据设为全局（空数组即全局，无需回填）
