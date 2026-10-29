ALTER TABLE "patient_diagnoses" ALTER COLUMN "tooth_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD COLUMN "level" charge_unit DEFAULT 'per_tooth' NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ADD COLUMN "level" charge_unit DEFAULT 'per_tooth' NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ADD COLUMN "jaw" "jaw";--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ADD CONSTRAINT "patient_diagnoses_tooth_matches_level" CHECK (("patient_diagnoses"."tooth_code" is not null) = ("patient_diagnoses"."level" = 'per_tooth'));--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ADD CONSTRAINT "patient_diagnoses_jaw_matches_level" CHECK (("patient_diagnoses"."jaw" is not null) = ("patient_diagnoses"."level"::text = 'per_jaw'));--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ADD CONSTRAINT "patient_diagnoses_surfaces_on_tooth" CHECK ("patient_diagnoses"."level" = 'per_tooth' or cardinality("patient_diagnoses"."surfaces") = 0);