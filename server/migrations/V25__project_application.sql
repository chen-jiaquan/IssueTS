-- 项目申请：项目档案增加申请状态与申请/审核信息
-- 申请提交后进入“申请中”，管理员审核通过后变为“已生效”，拒绝后为“已拒绝”。
-- 存量项目默认“已生效”，不影响现有业务。

ALTER TABLE projects
    ADD COLUMN status      varchar(16)  NOT NULL DEFAULT '已生效'
        CHECK (status IN ('申请中', '已生效', '已拒绝')),
    ADD COLUMN applicant   varchar(64),
    ADD COLUMN applied_at  timestamp,
    ADD COLUMN reviewed_by varchar(64),
    ADD COLUMN reviewed_at timestamp,
    ADD COLUMN review_note varchar(255);

CREATE INDEX idx_projects_status ON projects(status);
