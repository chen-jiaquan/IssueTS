-- 人员档案增加“所属项目”；存量数据按 users.person -> users.projects 回填。
ALTER TABLE personnel
  ADD COLUMN IF NOT EXISTS projects jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE personnel p
SET projects = COALESCE((
  SELECT jsonb_agg(DISTINCT pr.value ORDER BY pr.value)
  FROM users u
  CROSS JOIN LATERAL jsonb_array_elements_text(u.projects) AS pr(value)
  WHERE u.person = p.name
), '[]'::jsonb)
WHERE jsonb_array_length(p.projects) = 0;
