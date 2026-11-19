-- 字典项增加归属项目；空值表示所有项目都可使用。
ALTER TABLE dict_items
  ADD COLUMN IF NOT EXISTS project_code varchar(32) NOT NULL DEFAULT '';
