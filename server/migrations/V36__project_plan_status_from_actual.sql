-- 项目计划状态由实际日期驱动：实际完成非空 → 已解决；实际开始非空 → 进行中
UPDATE project_plans
SET status = CASE
      WHEN actual_end_date IS NOT NULL THEN '已解决'
      WHEN actual_start_date IS NOT NULL THEN '进行中'
      ELSE status
    END,
    updated_at = now()
WHERE actual_end_date IS NOT NULL OR actual_start_date IS NOT NULL;
