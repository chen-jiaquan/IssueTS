-- 项目计划：支持编写、上下级层级，父级时间/工时由子级自动汇总
CREATE TABLE IF NOT EXISTS project_plans (
  id varchar(32) PRIMARY KEY,
  project varchar(32) NOT NULL REFERENCES projects(code),
  parent_id varchar(32) REFERENCES project_plans(id) ON DELETE SET NULL,
  title varchar(255) NOT NULL,
  owner varchar(64),
  start_date date,
  end_date date,
  hours numeric(10,2) NOT NULL DEFAULT 0,
  sort int NOT NULL DEFAULT 0,
  note text,
  created_by varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_plans_project ON project_plans(project);
CREATE INDEX IF NOT EXISTS idx_project_plans_parent ON project_plans(parent_id);
