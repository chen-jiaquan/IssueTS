-- 项目计划调整工时：正数增加、负数扣减；实际工时与完成比例由服务层按日历动态计算
ALTER TABLE project_plans
  ADD COLUMN IF NOT EXISTS adjusted_hours numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN project_plans.adjusted_hours IS '调整工时（正数增加、负数扣减）';
