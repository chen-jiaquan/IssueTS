-- 权限位增加「禁止分配」开关：勾选后该权限不得在「角色权限」页签分配给角色。
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS no_assign boolean NOT NULL DEFAULT false;

-- 已被标记为禁止分配的权限，不再允许任何角色持有（清理历史分配）。
DELETE FROM role_permissions rp
USING permissions p
WHERE rp.perm_code = p.code AND p.no_assign = true;
