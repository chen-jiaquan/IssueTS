-- 项目计划清单：分类与前置任务（WBS/工期由层级与工作日历计算，不落库）
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS category varchar(100);
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS predecessor text;

COMMENT ON COLUMN project_plans.category IS '任务分类';
COMMENT ON COLUMN project_plans.predecessor IS '前置任务ID列表，逗号分隔';
