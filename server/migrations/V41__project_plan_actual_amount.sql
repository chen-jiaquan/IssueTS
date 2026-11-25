-- 实际金额：人天单价 × 实际工时 / 日历每日工时，保留 2 位小数
ALTER TABLE project_plans
  ADD COLUMN IF NOT EXISTS actual_amount numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN project_plans.actual_amount IS '实际金额（人天单价 × 实际人天，保留2位小数）';
