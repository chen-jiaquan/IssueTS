-- 权限位的「系统预置」字段已无实际效用（权限保护由 no_assign 承担），移除该列。
ALTER TABLE permissions DROP COLUMN IF EXISTS preset;
