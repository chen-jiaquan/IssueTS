-- 基础档案与用户权限数据增加“系统预置”标识；存量数据视为系统预置。
ALTER TABLE projects       ADD COLUMN IF NOT EXISTS preset boolean NOT NULL DEFAULT false;
ALTER TABLE products       ADD COLUMN IF NOT EXISTS preset boolean NOT NULL DEFAULT false;
ALTER TABLE personnel      ADD COLUMN IF NOT EXISTS preset boolean NOT NULL DEFAULT false;
ALTER TABLE dict_items     ADD COLUMN IF NOT EXISTS preset boolean NOT NULL DEFAULT false;
ALTER TABLE custom_fields  ADD COLUMN IF NOT EXISTS preset boolean NOT NULL DEFAULT false;
ALTER TABLE notice_types   ADD COLUMN IF NOT EXISTS preset boolean NOT NULL DEFAULT false;
ALTER TABLE todo_prios     ADD COLUMN IF NOT EXISTS preset boolean NOT NULL DEFAULT false;
ALTER TABLE roles          ADD COLUMN IF NOT EXISTS preset boolean NOT NULL DEFAULT false;
ALTER TABLE permissions    ADD COLUMN IF NOT EXISTS preset boolean NOT NULL DEFAULT false;
ALTER TABLE users          ADD COLUMN IF NOT EXISTS preset boolean NOT NULL DEFAULT false;
ALTER TABLE alert_rules    ADD COLUMN IF NOT EXISTS preset boolean NOT NULL DEFAULT false;

UPDATE projects       SET preset = true;
UPDATE products       SET preset = true;
UPDATE personnel      SET preset = true;
UPDATE dict_items     SET preset = true;
UPDATE custom_fields  SET preset = true;
UPDATE notice_types   SET preset = true;
UPDATE todo_prios     SET preset = true;
UPDATE roles          SET preset = true;
UPDATE permissions    SET preset = true;
UPDATE users          SET preset = true;
UPDATE alert_rules    SET preset = true;
