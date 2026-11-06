import type { ExportLanguage, PaymentMethod, PayrollLineStatus } from '@dcm/contracts';

/** The words of the payroll CSV exports, per language (the SPA's `payroll` strings). */
export interface PayrollExportLabels {
  history: {
    month: string;
    base: string;
    adjustments: string;
    net: string;
    currency: string;
    paidOn: string;
    method: string;
    status: string;
    note: string;
  };
  year: { month: string; paidNet: string; paid: string; pending: string };
  statuses: Record<PayrollLineStatus | 'voided', string>;
  methods: Record<PaymentMethod, string>;
}

export const PAYROLL_EXPORT_LABELS: Record<ExportLanguage, PayrollExportLabels> = {
  en: {
    history: {
      month: 'Month',
      base: 'Base salary',
      adjustments: 'Adjustments',
      net: 'Net pay',
      currency: 'Currency',
      paidOn: 'Paid on',
      method: 'Method',
      status: 'Status',
      note: 'Note',
    },
    year: { month: 'Month', paidNet: 'Net paid', paid: 'Lines paid', pending: 'Lines pending' },
    statuses: { pending: 'Pending', paid: 'Paid', skipped: 'Skipped', voided: 'Voided' },
    methods: {
      cash: 'Cash',
      card: 'Card',
      bank_transfer: 'Bank transfer',
      whish: 'Whish',
      insurance: 'Insurance',
    },
  },
  ar: {
    history: {
      month: 'الشهر',
      base: 'الراتب الأساسي',
      adjustments: 'التعديلات',
      net: 'صافي الراتب',
      currency: 'العملة',
      paidOn: 'تاريخ الدفع',
      method: 'طريقة الدفع',
      status: 'الحالة',
      note: 'ملاحظة',
    },
    year: {
      month: 'الشهر',
      paidNet: 'الصافي المدفوع',
      paid: 'بنود مدفوعة',
      pending: 'بنود معلّقة',
    },
    statuses: { pending: 'معلّق', paid: 'مدفوع', skipped: 'متخطّى', voided: 'ملغى' },
    methods: {
      cash: 'نقدًا',
      card: 'بطاقة',
      bank_transfer: 'تحويل مصرفي',
      whish: 'Whish',
      insurance: 'تأمين',
    },
  },
  fr: {
    history: {
      month: 'Mois',
      base: 'Salaire de base',
      adjustments: 'Ajustements',
      net: 'Net à payer',
      currency: 'Devise',
      paidOn: 'Payé le',
      method: 'Mode',
      status: 'Statut',
      note: 'Note',
    },
    year: {
      month: 'Mois',
      paidNet: 'Net payé',
      paid: 'Lignes payées',
      pending: 'Lignes en attente',
    },
    statuses: { pending: 'En attente', paid: 'Payé', skipped: 'Ignoré', voided: 'Annulé' },
    methods: {
      cash: 'Espèces',
      card: 'Carte',
      bank_transfer: 'Virement',
      whish: 'Whish',
      insurance: 'Assurance',
    },
  },
};
