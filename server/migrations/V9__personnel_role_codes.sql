-- 人员岗位统一存角色编码，避免角色改名后失配。
UPDATE personnel SET role = CASE
  WHEN role IN ('管理员') THEN 'R01'
  WHEN role IN ('项目经理') THEN 'R02'
  WHEN role IN ('交付顾问', '顾问') THEN 'R03'
  WHEN role IN ('开发人员', '开发') THEN 'R04'
  WHEN role IN ('客户测试', '客户测试人员', '客户') THEN 'R05'
  ELSE role
END
WHERE role NOT IN ('R01', 'R02', 'R03', 'R04', 'R05');
