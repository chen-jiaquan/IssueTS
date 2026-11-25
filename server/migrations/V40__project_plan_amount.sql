-- 项目计划金额字段：人天单价保留 2 位小数，金额 = 人天单价 × 人天（保留 2 位小数）
ALTER TABLE project_plans
  ADD COLUMN IF NOT EXISTS day_rate numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount numeric(14,2) NOT NULL DEFAULT 0;

UPDATE project_plans SET amount = ROUND(COALESCE(day_rate, 0) * COALESCE(man_days, 0), 2)
  WHERE amount IS NULL OR amount <> ROUND(COALESCE(day_rate, 0) * COALESCE(man_days, 0), 2);

COMMENT ON COLUMN project_plans.day_rate IS '人天单价（保留2位小数）';
COMMENT ON COLUMN project_plans.amount IS '金额 = 人天单价 × 人天（保留2位小数）';
