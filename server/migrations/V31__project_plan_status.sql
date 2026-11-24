-- 项目计划状态：复用基础档案字典 dict_key='status'
ALTER TABLE project_plans ADD COLUMN IF NOT EXISTS status varchar(32) DEFAULT '未开始';

COMMENT ON COLUMN project_plans.status IS '任务状态（取自 status 字典）';
UPDATE project_plans SET status = '未开始' WHERE status IS NULL;
