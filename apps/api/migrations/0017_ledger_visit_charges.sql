CREATE TABLE "ledger_entry_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tooth_code" text,
	"surfaces" text[] DEFAULT '{}'::text[] NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entry_lines_position_positive" CHECK ("ledger_entry_lines"."position" >= 1),
	CONSTRAINT "ledger_entry_lines_amount_non_negative" CHECK ("ledger_entry_lines"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ledger_entry_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "ledger_entry_lines" ADD CONSTRAINT "ledger_entry_lines_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entry_lines_tenant_idx" ON "ledger_entry_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entry_lines_position_unique" ON "ledger_entry_lines" USING btree ("tenant_id","entry_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_visit_unique" ON "ledger_entries" USING btree ("tenant_id","visit_id") WHERE "ledger_entries"."visit_id" is not null;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_visit_iff_charge" CHECK (("ledger_entries"."visit_id" is not null) = ("ledger_entries"."kind"::text = 'visit_charge'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ledger_entry_lines" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);