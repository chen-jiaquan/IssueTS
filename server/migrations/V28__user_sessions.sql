-- 在线会话：记录登录项目、访问令牌标识、登录/最后活跃时间，支持管理员查看在线时长并强制下线。
CREATE TABLE IF NOT EXISTS user_sessions (
    id            bigserial PRIMARY KEY,
    user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username      varchar(64) NOT NULL,
    access_jti    varchar(64) UNIQUE,
    refresh_jti   varchar(64) UNIQUE,
    login_project varchar(32),
    login_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    ended_at      timestamptz,
    end_reason    varchar(16)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(ended_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_project ON user_sessions(login_project) WHERE ended_at IS NULL;
