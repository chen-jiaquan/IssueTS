-- 现有数据均视为非系统预置；系统预置字段可在编辑界面自由修改。
UPDATE projects       SET preset = false;
UPDATE products       SET preset = false;
UPDATE personnel      SET preset = false;
UPDATE dict_items     SET preset = false;
UPDATE custom_fields  SET preset = false;
UPDATE notice_types   SET preset = false;
UPDATE todo_prios     SET preset = false;
UPDATE roles          SET preset = false;
UPDATE permissions    SET preset = false;
UPDATE users          SET preset = false;
UPDATE alert_rules    SET preset = false;
