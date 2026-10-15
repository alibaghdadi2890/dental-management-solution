ALTER TABLE "staff_profiles" ADD COLUMN "primary_specialty" text;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD COLUMN "specialties" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Every dentist has a primary specialty (ADR-0050): the dentists from before specialties,
-- owners included, start on General dentistry; a platform admin changes it in the Users tab.
UPDATE "staff_profiles"
SET "primary_specialty" = 'general', "specialties" = '{general}'::text[], "updated_at" = now()
WHERE "practitioner_type" = 'dentist';--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_specialty_iff_dentist" CHECK (("staff_profiles"."practitioner_type" = 'dentist') = ("staff_profiles"."primary_specialty" is not null));--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_primary_iff_specialties" CHECK (("staff_profiles"."primary_specialty" is null) = (cardinality("staff_profiles"."specialties") = 0));--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_primary_among_specialties" CHECK ("staff_profiles"."primary_specialty" is null or "staff_profiles"."primary_specialty" = any("staff_profiles"."specialties"));
