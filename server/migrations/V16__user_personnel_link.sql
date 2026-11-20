-- 用户增加人员档案来源标识，用于区分人员下推账号与手工账号。
-- personnel_code 由人员编码下推写入；仅当同名用户唯一时做存量回填，避免误关联。
ALTER TABLE users ADD COLUMN IF NOT EXISTS personnel_code varchar(16);

UPDATE users u
SET personnel_code = p.code
FROM personnel p
WHERE u.person = p.name
  AND NOT EXISTS (
    SELECT 1 FROM users u2 WHERE u2.person = p.name AND u2.id <> u.id
  );

CREATE UNIQUE INDEX IF NOT EXISTS uk_users_personnel_code
  ON users (personnel_code) WHERE personnel_code IS NOT NULL;
