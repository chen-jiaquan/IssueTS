-- 待办事项实际完成日期：勾选完成时自动回填
ALTER TABLE todos ADD COLUMN IF NOT EXISTS completed_at date;
