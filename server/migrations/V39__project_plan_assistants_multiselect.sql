-- 配合人1/2 支持多选，扩展存储长度以容纳逗号分隔的多个姓名
ALTER TABLE project_plans
  ALTER COLUMN assistant1 TYPE varchar(500),
  ALTER COLUMN assistant2 TYPE varchar(500);
