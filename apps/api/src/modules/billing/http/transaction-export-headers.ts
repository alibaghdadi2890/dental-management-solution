import type { ExportLanguage } from '@dcm/contracts';
import type { TransactionExportLabels } from '../application/payment-views.service';

/** The Transactions CSV's header row and values per language (the SPA's `payments` labels). */
const LABELS: Record<ExportLanguage, TransactionExportLabels> = {
  en: {
    date: 'Date',
    receipt: 'Receipt',
    patient: 'Patient',
    patientId: 'Patient ID',
    type: 'Type',
    method: 'Method',
    visits: 'Visits',
    recordedBy: 'Recorded by',
    amount: 'Amount',
    reference: 'Reference',
    reason: 'Reason',
    kinds: { payment: 'Payment', refund: 'Refund', void: 'Void' },
    methods: { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', insurance: 'Insurance' },
  },
  ar: {
    date: 'التاريخ',
    receipt: 'الإيصال',
    patient: 'المريض',
    patientId: 'رقم المريض',
    type: 'النوع',
    method: 'طريقة الدفع',
    visits: 'الزيارات',
    recordedBy: 'سجّلها',
    amount: 'المبلغ',
    reference: 'المرجع',
    reason: 'السبب',
    kinds: { payment: 'دفعة', refund: 'استرداد', void: 'إلغاء' },
    methods: { cash: 'نقدًا', card: 'بطاقة', bank_transfer: 'تحويل مصرفي', insurance: 'تأمين' },
  },
  fr: {
    date: 'Date',
    receipt: 'Reçu',
    patient: 'Patient',
    patientId: 'N° patient',
    type: 'Type',
    method: 'Moyen',
    visits: 'Visites',
    recordedBy: 'Saisi par',
    amount: 'Montant',
    reference: 'Référence',
    reason: 'Motif',
    kinds: { payment: 'Paiement', refund: 'Remboursement', void: 'Annulation' },
    methods: {
      cash: 'Espèces',
      card: 'Carte',
      bank_transfer: 'Virement',
      insurance: 'Assurance',
    },
  },
};

export function transactionExportLabels(language: ExportLanguage): TransactionExportLabels {
  return LABELS[language];
}
