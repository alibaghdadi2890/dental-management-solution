-- procedure:read / procedure:write became catalog:read / catalog:write (feature 2: the permissions
-- cover both the service and the diagnosis catalog). Unknown permission text grants nothing, so
-- roles seeded before the rename are rewritten. Runs as the schema owner: every tenant's rows.
UPDATE "role_permissions"
SET "permission" = 'catalog:' || split_part("permission", ':', 2), "updated_at" = now()
WHERE "permission" IN ('procedure:read', 'procedure:write');
