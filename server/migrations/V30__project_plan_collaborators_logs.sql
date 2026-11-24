-- 项目计划：配合人、跟踪记录，以及字段级修改日志
ALTER TABLE project_plans
  ADD COLUMN IF NOT EXISTS assistant1 varchar(100),
  ADD COLUMN IF NOT EXISTS assistant2 varchar(100),
  ADD COLUMN IF NOT EXISTS track jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS project_plan_logs (
  id bigserial PRIMARY KEY,
  plan_id varchar(32) NOT NULL REFERENCES project_plans(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by varchar(100),
  field_key varchar(100) NOT NULL,
  field_label varchar(100) NOT NULL,
  before_value text,
  after_value text
);

CREATE INDEX IF NOT EXISTS idx_project_plan_logs_plan ON project_plan_logs(plan_id);
CREATE INDEX IF NOT EXISTS idx_project_plan_logs_time ON project_plan_logs(changed_at DESC);
