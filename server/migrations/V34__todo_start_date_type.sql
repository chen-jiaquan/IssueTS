-- 待办事项：新增开始日期与待办类型（问题/计划/手工），类型值由 dict_items(todo_type) 维护
ALTER TABLE todos ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS type varchar(16) NOT NULL DEFAULT '手工'
  CHECK (type IN ('问题', '计划', '手工'));

COMMENT ON COLUMN todos.start_date IS '开始日期';
COMMENT ON COLUMN todos.type IS '待办类型：问题/计划/手工';

INSERT INTO dict_items (dict_key, value, label, color, sort, preset)
VALUES
  ('todo_type', '问题', '问题', '#4c9aff', 1, true),
  ('todo_type', '计划', '计划', '#a371f7', 2, true),
  ('todo_type', '手工', '手工', '#22c55e', 3, true)
ON CONFLICT (dict_key, value) DO NOTHING;
