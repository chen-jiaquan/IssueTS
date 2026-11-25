-- 项目计划：实际开始/实际完成日期与完成比例（0~100）。
ALTER TABLE project_plans
  ADD COLUMN IF NOT EXISTS actual_start_date date,
  ADD COLUMN IF NOT EXISTS actual_end_date date,
  ADD COLUMN IF NOT EXISTS completion_rate numeric(5,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN project_plans.actual_start_date IS '实际开始日期';
COMMENT ON COLUMN project_plans.actual_end_date IS '实际完成日期';
COMMENT ON COLUMN project_plans.completion_rate IS '完成比例（0~100）';
