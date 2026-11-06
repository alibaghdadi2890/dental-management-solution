import type {
  ExpenseCategoryKey,
  ExpenseSource,
  ExportLanguage,
  PaymentMethod,
} from '@dcm/contracts';

/**
 * The words of the expenses CSV export, per language (the SPA's `expenses` strings), and the
 * names of the keyed categories. A custom name may not repeat any of these (D7).
 */
export interface ExpenseExportLabels {
  columns: {
    date: string;
    category: string;
    payee: string;
    description: string;
    reference: string;
    branch: string;
    method: string;
    amount: string;
    currency: string;
    source: string;
    month: string;
    status: string;
    voidReason: string;
  };
  status: { recorded: string; voided: string };
  sources: Record<ExpenseSource, string>;
  methods: Record<PaymentMethod, string>;
  categories: Record<ExpenseCategoryKey, string>;
}

export const EXPENSE_EXPORT_LABELS: Record<ExportLanguage, ExpenseExportLabels> = {
  en: {
    columns: {
      date: 'Date',
      category: 'Category',
      payee: 'Payee',
      description: 'Description',
      reference: 'Reference',
      branch: 'Branch',
      method: 'Method',
      amount: 'Amount',
      currency: 'Currency',
      source: 'Source',
      month: 'For month',
      status: 'Status',
      voidReason: 'Void reason',
    },
    status: { recorded: 'Recorded', voided: 'Voided' },
    sources: {
      manual: 'Recorded',
      fixed: 'Fixed expense',
      payroll: 'Payroll',
      compensation: 'Compensation',
    },
    methods: {
      cash: 'Cash',
      card: 'Card',
      bank_transfer: 'Bank transfer',
      whish: 'Whish',
      insurance: 'Insurance',
    },
    categories: {
      rent: 'Rent',
      electricity: 'Electricity',
      water: 'Water',
      internet_phone: 'Internet & phone',
      supplies: 'Dental supplies & materials',
      lab_fees: 'Lab fees',
      equipment: 'Equipment & maintenance',
      cleaning: 'Cleaning & sanitation',
      marketing: 'Marketing',
      software: 'Software & subscriptions',
      taxes_fees: 'Taxes, licences & fees',
      insurance: 'Insurance',
      professional_fees: 'Professional fees',
      transport: 'Transport',
      other: 'Other',
      salaries: 'Salaries',
      dentist_compensation: 'Dentist compensation',
    },
  },
  ar: {
    columns: {
      date: 'التاريخ',
      category: 'الفئة',
      payee: 'المستفيد',
      description: 'الوصف',
      reference: 'المرجع',
      branch: 'الفرع',
      method: 'طريقة الدفع',
      amount: 'المبلغ',
      currency: 'العملة',
      source: 'المصدر',
      month: 'عن شهر',
      status: 'الحالة',
      voidReason: 'سبب الإلغاء',
    },
    status: { recorded: 'مسجّل', voided: 'ملغى' },
    sources: {
      manual: 'مسجّل',
      fixed: 'مصروف ثابت',
      payroll: 'الرواتب',
      compensation: 'التعويضات',
    },
    methods: {
      cash: 'نقدًا',
      card: 'بطاقة',
      bank_transfer: 'تحويل مصرفي',
      whish: 'Whish',
      insurance: 'تأمين',
    },
    categories: {
      rent: 'إيجار',
      electricity: 'كهرباء',
      water: 'مياه',
      internet_phone: 'إنترنت وهاتف',
      supplies: 'مستلزمات ومواد طب الأسنان',
      lab_fees: 'رسوم المختبر',
      equipment: 'معدات وصيانة',
      cleaning: 'تنظيف وتعقيم',
      marketing: 'تسويق',
      software: 'برمجيات واشتراكات',
      taxes_fees: 'ضرائب ورخص ورسوم',
      insurance: 'تأمين',
      professional_fees: 'أتعاب مهنية',
      transport: 'نقل ومواصلات',
      other: 'أخرى',
      salaries: 'رواتب',
      dentist_compensation: 'تعويضات الأطباء',
    },
  },
  fr: {
    columns: {
      date: 'Date',
      category: 'Catégorie',
      payee: 'Bénéficiaire',
      description: 'Description',
      reference: 'Référence',
      branch: 'Site',
      method: 'Mode',
      amount: 'Montant',
      currency: 'Devise',
      source: 'Origine',
      month: 'Pour le mois',
      status: 'Statut',
      voidReason: "Motif d'annulation",
    },
    status: { recorded: 'Enregistrée', voided: 'Annulée' },
    sources: {
      manual: 'Saisie',
      fixed: 'Dépense fixe',
      payroll: 'Paie',
      compensation: 'Rémunération',
    },
    methods: {
      cash: 'Espèces',
      card: 'Carte',
      bank_transfer: 'Virement',
      whish: 'Whish',
      insurance: 'Assurance',
    },
    categories: {
      rent: 'Loyer',
      electricity: 'Électricité',
      water: 'Eau',
      internet_phone: 'Internet et téléphone',
      supplies: 'Fournitures et matériaux dentaires',
      lab_fees: 'Frais de laboratoire',
      equipment: 'Équipement et maintenance',
      cleaning: 'Nettoyage et désinfection',
      marketing: 'Marketing',
      software: 'Logiciels et abonnements',
      taxes_fees: 'Taxes, licences et frais',
      insurance: 'Assurance',
      professional_fees: 'Honoraires professionnels',
      transport: 'Transport',
      other: 'Autre',
      salaries: 'Salaires',
      dentist_compensation: 'Rémunération des dentistes',
    },
  },
};

/** Every translation of every keyed category: what a custom name may not be. */
export const KEYED_CATEGORY_NAMES: readonly string[] = Object.values(EXPENSE_EXPORT_LABELS).flatMap(
  (labels) => Object.values(labels.categories),
);
