-- 通知增加项目（必填）、接收人、所属组；历史通知回填默认项目
ALTER TABLE notices
  ADD COLUMN IF NOT EXISTS project varchar(32),
  ADD COLUMN IF NOT EXISTS recipients text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "groups" text[] NOT NULL DEFAULT '{}';

UPDATE notices
SET project = COALESCE(NULLIF(project, ''), (SELECT code FROM projects WHERE enabled = true ORDER BY code LIMIT 1), '')
WHERE project IS NULL OR project = '';

ALTER TABLE notices ALTER COLUMN project SET NOT NULL;
