-- 用户注册审核：人员档案增加注册状态与审核信息
-- 注册提交先进入人员档案（申请中），由项目经理或管理员审核通过后
-- 才生成/同步用户账号并置为已生效；存量人员默认已生效。

ALTER TABLE personnel
    ADD COLUMN status      varchar(16)  NOT NULL DEFAULT '已生效'
        CHECK (status IN ('申请中', '已生效', '已拒绝')),
    ADD COLUMN applied_at  timestamp,
    ADD COLUMN reviewed_by varchar(64),
    ADD COLUMN reviewed_at timestamp,
    ADD COLUMN review_note varchar(255);

CREATE INDEX idx_personnel_status ON personnel(status);
