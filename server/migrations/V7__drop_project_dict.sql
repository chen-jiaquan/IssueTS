-- 项目状态字典无实际意义，项目下拉统一使用 projects 档案。
DELETE FROM dict_items WHERE dict_key = 'project';
