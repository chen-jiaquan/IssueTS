-- V2：Refresh Token 撤销表（登出使 Refresh 失效；多副本无状态共享，替代内存黑名单）
CREATE TABLE refresh_revocations (
    jti        varchar(64) PRIMARY KEY,   -- refresh token 的 jwtid
    revoked_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL       -- 到期后可由清理任务删除
);
CREATE INDEX idx_revocations_expires ON refresh_revocations(expires_at);
