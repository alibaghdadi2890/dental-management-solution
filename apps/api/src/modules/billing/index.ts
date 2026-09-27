// Public API of the billing module. Other modules import from this file only (CLAUDE.md §4).
export { BillingModule } from './billing.module';
export { BillingService } from './application/billing.service';
export { LEDGER_ENTRY_RECORDED, type LedgerEntryRecorded } from './events/ledger-events';
