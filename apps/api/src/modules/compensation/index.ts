// Public API of the compensation module. Other modules import from this file only (CLAUDE.md §4).
export { CompensationModule } from './compensation.module';
export {
  PAYOUT_RECORDED,
  PAYOUT_VOIDED,
  type PayoutRecorded,
  type PayoutVoided,
} from './events/compensation-events';
