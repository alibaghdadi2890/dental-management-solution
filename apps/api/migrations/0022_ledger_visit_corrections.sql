ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_visit_iff_charge";--> statement-breakpoint
DROP INDEX "ledger_entries_visit_unique";--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "amendment_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_visit_kind_unique" ON "ledger_entries" USING btree ("tenant_id","visit_id","kind",coalesce("amendment_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "ledger_entries"."visit_id" is not null;--> statement-breakpoint
CREATE INDEX "ledger_entries_visit_idx" ON "ledger_entries" USING btree ("tenant_id","visit_id") WHERE "ledger_entries"."visit_id" is not null;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_visit_iff_visit_kind" CHECK (("ledger_entries"."visit_id" is not null) = ("ledger_entries"."kind"::text in ('visit_charge', 'visit_charge_adjustment', 'visit_charge_reversal')));--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amendment_iff_adjustment" CHECK (("ledger_entries"."amendment_id" is not null) = ("ledger_entries"."kind"::text = 'visit_charge_adjustment'));