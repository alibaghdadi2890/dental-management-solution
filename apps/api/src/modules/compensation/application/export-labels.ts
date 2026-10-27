import type {
  AdjustmentKind,
  ComponentKind,
  ExportLanguage,
  PaymentMethod,
  ReportRowStatus,
} from '@dcm/contracts';

/** The words of the compensation CSV exports, per language (the SPA's `compensation` strings). */
export interface CompensationExportLabels {
  report: {
    dentist: string;
    visits: string;
    production: string;
    collections: string;
    earned: string;
    adjustments: string;
    payouts: string;
    balance: string;
    status: string;
    unattributed: string;
  };
  statuses: Record<ReportRowStatus, string>;
  statement: {
    section: string;
    date: string;
    visit: string;
    patient: string;
    base: string;
    rate: string;
    count: string;
    amount: string;
    late: string;
    noAgreement: string;
    notComputed: string;
    threshold: string;
    opening: string;
    closing: string;
    voided: string;
  };
  components: Record<ComponentKind, string>;
  adjustmentKinds: Record<AdjustmentKind, string>;
  methods: Record<PaymentMethod, string>;
}

export const EXPORT_LABELS: Record<ExportLanguage, CompensationExportLabels> = {
  en: {
    report: {
      dentist: 'Dentist',
      visits: 'Visits',
      production: 'Production',
      collections: 'Collections',
      earned: 'Earned',
      adjustments: 'Adjustments',
      payouts: 'Payouts',
      balance: 'Balance',
      status: 'Status',
      unattributed: 'Unattributed',
    },
    statuses: { provisional: 'Provisional', closed: 'Closed', none: 'No agreement' },
    statement: {
      section: 'Section',
      date: 'Date',
      visit: 'Visit',
      patient: 'Patient',
      base: 'Base',
      rate: 'Rate %',
      count: 'Count',
      amount: 'Amount',
      late: 'Late entries from',
      noAgreement: 'No agreement',
      notComputed: 'Not computed',
      threshold: 'Below minimum base',
      opening: 'Opening balance',
      closing: 'Closing balance',
      voided: 'Voided',
    },
    components: {
      monthlyFixed: 'Fixed',
      share: 'Share',
      perVisit: 'Per visit',
      perDay: 'Per day',
    },
    adjustmentKinds: {
      bonus: 'Bonus',
      deduction: 'Deduction',
      lab_cost: 'Lab cost',
      materials: 'Materials',
      advance: 'Advance',
      opening_balance: 'Opening balance',
      correction: 'Correction',
      other: 'Other',
    },
    methods: {
      cash: 'Cash',
      card: 'Card',
      bank_transfer: 'Bank transfer',
      whish: 'Whish',
      insurance: 'Insurance',
    },
  },
  ar: {
    report: {
      dentist: 'الطبيب',
      visits: 'الزيارات',
      production: 'المفوتر',
      collections: 'المحصّل',
      earned: 'المستحق',
      adjustments: 'التعديلات',
      payouts: 'المدفوعات',
      balance: 'الرصيد',
      status: 'الحالة',
      unattributed: 'غير منسوب',
    },
    statuses: { provisional: 'مؤقت', closed: 'مغلق', none: 'لا اتفاقية' },
    statement: {
      section: 'القسم',
      date: 'التاريخ',
      visit: 'الزيارة',
      patient: 'المريض',
      base: 'الأساس',
      rate: 'النسبة %',
      count: 'العدد',
      amount: 'المبلغ',
      late: 'قيود متأخرة من',
      noAgreement: 'لا اتفاقية',
      notComputed: 'غير محتسب',
      threshold: 'دون الحد الأدنى',
      opening: 'الرصيد الافتتاحي',
      closing: 'الرصيد الختامي',
      voided: 'ملغى',
    },
    components: {
      monthlyFixed: 'مبلغ ثابت',
      share: 'نسبة',
      perVisit: 'لكل زيارة',
      perDay: 'لكل يوم',
    },
    adjustmentKinds: {
      bonus: 'مكافأة',
      deduction: 'خصم',
      lab_cost: 'كلفة مختبر',
      materials: 'مواد',
      advance: 'سلفة',
      opening_balance: 'رصيد افتتاحي',
      correction: 'تصحيح',
      other: 'أخرى',
    },
    methods: {
      cash: 'نقدًا',
      card: 'بطاقة',
      bank_transfer: 'تحويل مصرفي',
      whish: 'Whish',
      insurance: 'تأمين',
    },
  },
  fr: {
    report: {
      dentist: 'Dentiste',
      visits: 'Visites',
      production: 'Facturé',
      collections: 'Encaissé',
      earned: 'Gagné',
      adjustments: 'Ajustements',
      payouts: 'Versements',
      balance: 'Solde',
      status: 'Statut',
      unattributed: 'Non attribué',
    },
    statuses: { provisional: 'Provisoire', closed: 'Clôturé', none: 'Sans accord' },
    statement: {
      section: 'Section',
      date: 'Date',
      visit: 'Visite',
      patient: 'Patient',
      base: 'Base',
      rate: 'Taux %',
      count: 'Nombre',
      amount: 'Montant',
      late: 'Écritures tardives de',
      noAgreement: 'Sans accord',
      notComputed: 'Non calculé',
      threshold: 'Sous la base minimale',
      opening: "Solde d'ouverture",
      closing: 'Solde de clôture',
      voided: 'Annulé',
    },
    components: {
      monthlyFixed: 'Fixe',
      share: 'Pourcentage',
      perVisit: 'Par visite',
      perDay: 'Par jour',
    },
    adjustmentKinds: {
      bonus: 'Prime',
      deduction: 'Retenue',
      lab_cost: 'Frais de laboratoire',
      materials: 'Matériaux',
      advance: 'Avance',
      opening_balance: "Solde d'ouverture",
      correction: 'Correction',
      other: 'Autre',
    },
    methods: {
      cash: 'Espèces',
      card: 'Carte',
      bank_transfer: 'Virement',
      whish: 'Whish',
      insurance: 'Assurance',
    },
  },
};
