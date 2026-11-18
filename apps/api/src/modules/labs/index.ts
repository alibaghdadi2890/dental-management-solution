// Public API of the labs module. Other modules import from this file only (CLAUDE.md §4).
export { LabsModule } from './labs.module';
export {
  LAB_PAYMENT_RECORDED,
  LAB_PAYMENT_VOIDED,
  type LabPaymentRecorded,
  type LabPaymentVoided,
} from './events/lab-events';
