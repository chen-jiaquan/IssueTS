-- 待办事项增加多选项目；空数组表示全员可见
ALTER TABLE todos ADD COLUMN IF NOT EXISTS projects text[] NOT NULL DEFAULT '{}';
