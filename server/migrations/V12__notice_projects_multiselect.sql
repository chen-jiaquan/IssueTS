-- 通知项目由单值改为多选数组
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notices' AND column_name='project')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notices' AND column_name='projects') THEN
    ALTER TABLE notices RENAME COLUMN project TO projects;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notices' AND column_name='projects' AND data_type='character varying') THEN
    ALTER TABLE notices ALTER COLUMN projects TYPE text[] USING ARRAY[projects]::text[];
  END IF;
END $$;

ALTER TABLE notices ADD COLUMN IF NOT EXISTS projects text[] NOT NULL DEFAULT '{}';
UPDATE notices SET projects = array_remove(projects, '') WHERE projects IS NOT NULL AND '' = ANY(projects);
UPDATE notices SET projects = '{}'::text[] WHERE projects IS NULL;
ALTER TABLE notices ALTER COLUMN projects SET NOT NULL;
