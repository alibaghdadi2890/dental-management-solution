-- Tenants provisioned before the owner-type default carry an owner typed `other`, so the owner
-- is missing from the dentist pickers (feature 7, H9a). Every owner still typed `other` becomes a
-- dentist; one who is not a dentist is set back in the tenant's Users tab.
UPDATE "staff_profiles" AS p
SET "practitioner_type" = 'dentist', "updated_at" = now()
FROM "user_roles" AS ur
JOIN "roles" AS r ON r."tenant_id" = ur."tenant_id" AND r."id" = ur."role_id"
WHERE r."key" = 'owner'
  AND ur."tenant_id" = p."tenant_id"
  AND ur."user_id" = p."auth_user_id"
  AND p."practitioner_type" = 'other';
