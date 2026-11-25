-- 档案金额/人天字段，以及自定义字段与必填字段的业务模块维度
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS contract_man_days numeric(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN projects.contract_man_days IS '合同人天（保留2位小数）';

ALTER TABLE personnel
  ADD COLUMN IF NOT EXISTS day_rate numeric(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN personnel.day_rate IS '个人天单价（金额，保留2位小数）';

-- module=issue 问题跟踪，module=plan 项目计划；存量字段默认归入问题跟踪
ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS module varchar(16) NOT NULL DEFAULT 'issue';
ALTER TABLE custom_fields DROP CONSTRAINT IF EXISTS custom_fields_module_check;
ALTER TABLE custom_fields ADD CONSTRAINT custom_fields_module_check CHECK (module IN ('issue', 'plan'));
COMMENT ON COLUMN custom_fields.module IS '所属业务模块：issue=问题跟踪，plan=项目计划';

ALTER TABLE required_fields
  ADD COLUMN IF NOT EXISTS module varchar(16) NOT NULL DEFAULT 'issue';
ALTER TABLE required_fields DROP CONSTRAINT IF EXISTS required_fields_module_check;
ALTER TABLE required_fields ADD CONSTRAINT required_fields_module_check CHECK (module IN ('issue', 'plan'));
ALTER TABLE required_fields DROP CONSTRAINT IF EXISTS required_fields_pkey;
ALTER TABLE required_fields ADD PRIMARY KEY (module, field_key);
COMMENT ON COLUMN required_fields.module IS '所属业务模块：issue=问题跟踪，plan=项目计划';

-- 项目计划支持自定义字段值，键与 custom_fields.key 对应
ALTER TABLE project_plans
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN project_plans.custom_fields IS '项目计划自定义字段值（cf_N -> 值）';
