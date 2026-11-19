-- 用户与权限：角色/预警规则增加所属项目；系统设置支持按项目配置。
-- 空数组表示全局（系统管理员可留空）；['ALL'] 表示全部项目。
ALTER TABLE roles       ADD COLUMN IF NOT EXISTS projects text[] NOT NULL DEFAULT '{}';
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS projects text[] NOT NULL DEFAULT '{}';

-- 存量角色/预警规则为全局配置，显式标记为 ALL，保证项目过滤可见且满足必填口径。
UPDATE roles       SET projects = ARRAY['ALL']::text[] WHERE cardinality(projects) = 0;
UPDATE alert_rules SET projects = ARRAY['ALL']::text[] WHERE cardinality(projects) = 0;

CREATE TABLE IF NOT EXISTS system_settings (
    id          bigserial PRIMARY KEY,
    setting_key text        NOT NULL,
    projects    text[]      NOT NULL DEFAULT '{}',
    value       text        NOT NULL,
    created_at  timestamp   NOT NULL DEFAULT now(),
    updated_at  timestamp   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_system_settings_key_projects
    ON system_settings (setting_key, projects);

-- 兼容历史 app_meta 中的全局设置，迁移为项目维度设置（空数组=全局）。
INSERT INTO system_settings (setting_key, projects, value)
SELECT 'issue_export_limit', '{}'::text[], value FROM app_meta WHERE key = 'issue_export_limit'
ON CONFLICT DO NOTHING;
INSERT INTO system_settings (setting_key, projects, value)
SELECT 'default_user_password', '{}'::text[], value FROM app_meta WHERE key = 'default_user_password'
ON CONFLICT DO NOTHING;
