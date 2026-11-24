-- 问题记录乐观锁：编辑保存时校验版本号，防止多人并发覆盖
ALTER TABLE issues ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN issues.version IS '乐观锁版本号，每次写入递增';
