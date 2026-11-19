-- 人员岗位改为对应角色档案名称；历史“客户测试”对齐到角色“客户测试人员”。
UPDATE personnel SET role = '客户测试人员' WHERE role = '客户测试';
