-- 工作日历：按年维护节假日与调休补班，作为项目计划工时/人天计算依据。
CREATE TABLE IF NOT EXISTS work_calendars (
  year integer PRIMARY KEY,
  holidays date[] NOT NULL DEFAULT '{}',
  workdays date[] NOT NULL DEFAULT '{}',
  hours_per_day numeric(5,2) NOT NULL DEFAULT 8,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 项目计划增加人天字段（由起止日期与工作日历计算或按月汇总）。
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS man_days numeric(10,2) NOT NULL DEFAULT 0;
