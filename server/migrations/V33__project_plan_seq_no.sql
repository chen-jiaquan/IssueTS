-- 项目计划序号：点分编号（如 1、1.2、1.2.3），用于判定层级并生成 WBS 编号。
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS seq_no varchar(64);

COMMENT ON COLUMN project_plans.seq_no IS '计划序号（点分编号，如 1.2.3）';
CREATE INDEX IF NOT EXISTS idx_project_plans_seq_no ON project_plans(project, seq_no);
