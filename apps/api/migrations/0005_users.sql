CREATE TABLE "staff_branches" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_branches_pk" PRIMARY KEY("auth_user_id","branch_id")
);
--> statement-breakpoint
ALTER TABLE "staff_branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"title" text,
	"practitioner_type" text NOT NULL,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profiles_tenant_user_unique" UNIQUE("tenant_id","auth_user_id")
);
--> statement-breakpoint
ALTER TABLE "staff_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_profile_fk" FOREIGN KEY ("tenant_id","auth_user_id") REFERENCES "public"."staff_profiles"("tenant_id","auth_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_branches_tenant_idx" ON "staff_branches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "staff_profiles_tenant_idx" ON "staff_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_branches" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_profiles" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);