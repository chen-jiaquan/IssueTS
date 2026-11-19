-- =====================================================================
-- V1__init.sql：完整初始表结构（对应 docs/数据模型.md）
-- 表清单：roles / permissions / users / role_permissions / projects /
--         products / personnel / dict_items / issues / issue_logs /
--         custom_fields / required_fields / notice_types / todo_prios /
--         notices / todos / alert_rules / app_meta
-- 约定：主键 id 用 bigserial；业务序号 seq 由应用生成；jsonb 用于
--       track/logs/projects/custom_fields；时间默认 now()
-- =====================================================================

-- ---------- 1.1 角色 ----------
CREATE TABLE roles (
    code      varchar(16) PRIMARY KEY,
    name      varchar(32) NOT NULL UNIQUE,
    "desc"    varchar(128),
    external  boolean     NOT NULL DEFAULT false,
    color     varchar(32),
    preset    boolean     NOT NULL DEFAULT false -- 系统预置数据，默认不可删除/禁用
);

-- ---------- 1.2 权限（20 项） ----------
CREATE TABLE permissions (
    code   varchar(32) PRIMARY KEY,
    module varchar(32),
    name   varchar(64) NOT NULL,
    "desc" varchar(128),
    allow  jsonb,         -- 种子默认授权角色名数组（由 seed 展开写入 role_permissions）
    preset boolean NOT NULL DEFAULT false
);

-- ---------- 1.3 用户 ----------
CREATE TABLE users (
    id            bigserial PRIMARY KEY,
    username      varchar(64) NOT NULL UNIQUE,          -- uk_users_username
    password_hash varchar(255) NOT NULL,                -- bcrypt/argon2，禁明文
    person        varchar(64),                          -- 绑定 personnel.name
    role_code     varchar(16) REFERENCES roles(code),
    status        varchar(8)  NOT NULL DEFAULT '启用' CHECK (status IN ('启用','停用')),
    projects      jsonb       NOT NULL,                 -- ["ALL"] 或项目编码数组
    created_at    timestamp   NOT NULL DEFAULT now(),
    preset        boolean     NOT NULL DEFAULT false
);

-- ---------- 1.4 角色×权限分配矩阵 ----------
CREATE TABLE role_permissions (
    role_code varchar(16) NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
    perm_code varchar(32) NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role_code, perm_code)
);

-- ---------- 2.1 项目 ----------
CREATE TABLE projects (
    code    varchar(32) PRIMARY KEY,
    name    varchar(128),
    note    varchar(255),
    color   varchar(32),
    enabled boolean NOT NULL DEFAULT true,
    preset  boolean NOT NULL DEFAULT false
);

-- ---------- 2.2 产品 ----------
CREATE TABLE products (
    code    varchar(32) PRIMARY KEY,
    note    varchar(255),
    color   varchar(32),
    enabled boolean NOT NULL DEFAULT true,
    preset  boolean NOT NULL DEFAULT false
);

-- ---------- 2.3 人员（负责人/开发人员/提出人共用） ----------
CREATE TABLE personnel (
    code  varchar(16) PRIMARY KEY,
    name  varchar(64) NOT NULL UNIQUE,
    role  varchar(32),
    "group" varchar(64),          -- 所属组
    color varchar(32),
    projects jsonb NOT NULL DEFAULT '[]'::jsonb, -- 所属项目编码数组，['ALL'] 表示全部项目
    enabled boolean NOT NULL DEFAULT true,
    preset  boolean NOT NULL DEFAULT false
);

-- ---------- 2.4 数据字典（统一表） ----------
CREATE TABLE dict_items (
    id           bigserial PRIMARY KEY,
    dict_key     varchar(32) NOT NULL,   -- stage/type/module/priority/impact/status/pending_test/customer_test
    value        varchar(64) NOT NULL,
    label        varchar(128),
    color        varchar(32),
    note         varchar(255),
    product_code varchar(32) REFERENCES products(code),  -- 仅 module 用（所属产品）
    project_code varchar(32) NOT NULL DEFAULT '',       -- 归属项目编码，空=全部项目可用
    sort         int NOT NULL DEFAULT 0,
    enabled      boolean NOT NULL DEFAULT true,
    preset       boolean NOT NULL DEFAULT false,
    CONSTRAINT uk_dict UNIQUE (dict_key, value)
);
CREATE INDEX idx_dict_key ON dict_items(dict_key);

-- ---------- 3.1 问题跟踪（核心） ----------
CREATE TABLE issues (
    id                 bigserial PRIMARY KEY,
    seq                int NOT NULL UNIQUE,              -- 业务序号（应用生成：当前最大+1）
    project            varchar(32) NOT NULL REFERENCES projects(code),
    stage              varchar(64),
    type               varchar(64),
    module             varchar(64),
    "desc"             text NOT NULL,                    -- 需求描述（desc 为 SQL 保留字，加引号）
    priority           varchar(8)  NOT NULL CHECK (priority IN ('C','H','M','L')),
    impact             varchar(8),
    reporter           varchar(64),
    reported_at        date,
    owner              varchar(64),
    plan_start         date,
    plan_end           date,
    developer          varchar(64),
    solution           text,
    track              jsonb,                            -- [{date,text,by}]
    pending_test       varchar(8),
    status             varchar(32) NOT NULL,             -- 值域由 dict_items(status) 管理与应用层校验
    resolved_at        date,
    customer_test      varchar(8),
    customer_test_done date,
    image_url          varchar(512),                     -- 上传后文件 URL，非 dataURL
    custom_fields      jsonb,                            -- 自定义字段键值对
    created_by         varchar(64),
    created_at         timestamp NOT NULL DEFAULT now(),
    updated_at         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_issues_project  ON issues(project);    -- 数据范围过滤高频
CREATE INDEX idx_issues_status   ON issues(status);
CREATE INDEX idx_issues_owner    ON issues(owner);
CREATE INDEX idx_issues_developer ON issues(developer);
CREATE INDEX idx_issues_plan_end ON issues(plan_end);   -- 预警/统计时间轴

-- ---------- 3.2 字段级修改日志 ----------
CREATE TABLE issue_logs (
    id           bigserial PRIMARY KEY,
    issue_id     bigint NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    issue_seq    int,                                    -- 冗余序号，便于展示
    changed_at   timestamp NOT NULL DEFAULT now(),
    changed_by   varchar(64),
    field_key    varchar(64),
    field_label  varchar(128),
    before_value text,                                   -- 空值表示原为空
    after_value  text
);
CREATE INDEX idx_logs_issue   ON issue_logs(issue_id);
CREATE INDEX idx_logs_changed ON issue_logs(changed_at);
CREATE INDEX idx_logs_by      ON issue_logs(changed_by);

-- ---------- 4.1 自定义字段定义 ----------
CREATE TABLE custom_fields (
    key     varchar(64) PRIMARY KEY,        -- cf_ + 序号
    label   varchar(64) NOT NULL,
    type    varchar(16) NOT NULL CHECK (type IN ('text','textarea','number','date')),
    enabled boolean NOT NULL DEFAULT true,
    preset  boolean NOT NULL DEFAULT false
);

-- ---------- 4.2 必填字段配置 ----------
CREATE TABLE required_fields (
    field_key varchar(64) PRIMARY KEY     -- 初始: project/desc/priority/status
);

-- ---------- 4.3 通知类型（首项为默认） ----------
CREATE TABLE notice_types (
    id      bigserial PRIMARY KEY,
    name    varchar(32) NOT NULL UNIQUE,
    enabled boolean NOT NULL DEFAULT true,
    preset  boolean NOT NULL DEFAULT false
);

-- ---------- 4.4 待办优先级 ----------
CREATE TABLE todo_prios (
    code    varchar(8) PRIMARY KEY,         -- C/H/M/L
    label   varchar(64),
    enabled boolean NOT NULL DEFAULT true,
    preset  boolean NOT NULL DEFAULT false
);

-- ---------- 4.5 通知消息 ----------
CREATE TABLE notices (
    id         varchar(16) PRIMARY KEY,   -- n1..
    type       varchar(32) REFERENCES notice_types(name),
    title      varchar(255) NOT NULL,
    content    text,
    date       date,
    pinned     boolean NOT NULL DEFAULT false,
    created_by varchar(64),
    created_at timestamp NOT NULL DEFAULT now()
);

-- ---------- 4.6 待办事项 ----------
CREATE TABLE todos (
    id         varchar(16) PRIMARY KEY,   -- t1..
    text       varchar(512) NOT NULL,
    owner      varchar(64),
    due        date,
    prio       varchar(8) REFERENCES todo_prios(code),
    done       boolean NOT NULL DEFAULT false,
    created_at timestamp NOT NULL DEFAULT now()
);

-- ---------- 4.7 预警规则 ----------
CREATE TABLE alert_rules (
    key     varchar(32) PRIMARY KEY,      -- overdue/highPause/custTest
    enabled boolean NOT NULL,
    days    int,                          -- overdue=0（已过期）；custTest=7；highPause 无阈值
    label   varchar(128),
    preset  boolean NOT NULL DEFAULT false
);

-- ---------- 应用元信息（迁移/种子标记、系统设置等） ----------
CREATE TABLE app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
