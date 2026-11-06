// Public API of the payroll module. Other modules import from this file only (CLAUDE.md §4);
// `expenses` imports its events (ADR-0076).
export { PayrollModule } from './payroll.module';
export {
  PAYROLL_PAYMENT_CONFIRMED,
  PAYROLL_PAYMENT_VOIDED,
  type PayrollPaymentConfirmed,
  type PayrollPaymentVoided,
} from './events/payroll-events';
