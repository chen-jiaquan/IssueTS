-- 清理历史遗留：无实际日期但状态仍停留在进行中/已解决的计划回退为未开始
UPDATE project_plans
SET status = '未开始', updated_at = now()
WHERE actual_start_date IS NULL
  AND actual_end_date IS NULL
  AND status IN ('进行中', '已解决');
