import type {
  ExportLanguage,
  LabOrderStatus,
  LabStatementKind,
  PaymentMethod,
} from '@dcm/contracts';

/** The words of the lab CSV exports, per language (the SPA's `labs` strings). */
export interface LabExportLabels {
  statement: {
    date: string;
    kind: string;
    order: string;
    patient: string;
    description: string;
    method: string;
    amount: string;
    balance: string;
    status: string;
    balanceBefore: string;
  };
  orders: {
    number: string;
    created: string;
    patient: string;
    dentist: string;
    lab: string;
    items: string;
    status: string;
    priority: string;
    sent: string;
    expected: string;
    received: string;
    appointment: string;
    cost: string;
  };
  kinds: Record<LabStatementKind, string>;
  statuses: Record<LabOrderStatus, string>;
  urgent: string;
  methods: Record<PaymentMethod, string>;
  voided: string;
}

export const LAB_EXPORT_LABELS: Record<ExportLanguage, LabExportLabels> = {
  en: {
    statement: {
      date: 'Date',
      kind: 'Entry',
      order: 'Order',
      patient: 'Patient',
      description: 'Description',
      method: 'Method',
      amount: 'Amount',
      balance: 'Balance',
      status: 'Status',
      balanceBefore: 'Balance before the period',
    },
    orders: {
      number: 'Order',
      created: 'Created',
      patient: 'Patient',
      dentist: 'Dentist',
      lab: 'Lab',
      items: 'Items',
      status: 'Status',
      priority: 'Priority',
      sent: 'Sent',
      expected: 'Expected',
      received: 'Received',
      appointment: 'Appointment',
      cost: 'Cost',
    },
    kinds: {
      opening: 'Opening balance',
      order: 'Order delivered',
      remake: 'Remake charge',
      cancellation: 'Cancellation charge',
      adjustment: 'Adjustment',
      payment: 'Payment',
    },
    statuses: {
      to_send: 'To send',
      at_lab: 'At the lab',
      arrived: 'Arrived',
      done: 'Done',
      on_hold: 'On hold',
      remake: 'Remake',
      cancelled: 'Cancelled',
    },
    urgent: 'Urgent',
    methods: {
      cash: 'Cash',
      card: 'Card',
      bank_transfer: 'Bank transfer',
      whish: 'Whish',
      insurance: 'Insurance',
    },
    voided: 'Voided',
  },
  ar: {
    statement: {
      date: 'التاريخ',
      kind: 'القيد',
      order: 'الطلب',
      patient: 'المريض',
      description: 'الوصف',
      method: 'طريقة الدفع',
      amount: 'المبلغ',
      balance: 'الرصيد',
      status: 'الحالة',
      balanceBefore: 'الرصيد قبل الفترة',
    },
    orders: {
      number: 'الطلب',
      created: 'تاريخ الإنشاء',
      patient: 'المريض',
      dentist: 'الطبيب',
      lab: 'المختبر',
      items: 'البنود',
      status: 'الحالة',
      priority: 'الأولوية',
      sent: 'أُرسل',
      expected: 'متوقع',
      received: 'استُلم',
      appointment: 'الموعد',
      cost: 'التكلفة',
    },
    kinds: {
      opening: 'رصيد افتتاحي',
      order: 'طلب مُسلَّم',
      remake: 'رسوم إعادة',
      cancellation: 'رسوم إلغاء',
      adjustment: 'تسوية',
      payment: 'دفعة',
    },
    statuses: {
      to_send: 'للإرسال',
      at_lab: 'في المختبر',
      arrived: 'وصل',
      done: 'منجز',
      on_hold: 'معلّق',
      remake: 'إعادة',
      cancelled: 'ملغى',
    },
    urgent: 'عاجل',
    methods: {
      cash: 'نقدًا',
      card: 'بطاقة',
      bank_transfer: 'تحويل مصرفي',
      whish: 'Whish',
      insurance: 'تأمين',
    },
    voided: 'ملغاة',
  },
  fr: {
    statement: {
      date: 'Date',
      kind: 'Écriture',
      order: 'Commande',
      patient: 'Patient',
      description: 'Description',
      method: 'Mode',
      amount: 'Montant',
      balance: 'Solde',
      status: 'Statut',
      balanceBefore: 'Solde avant la période',
    },
    orders: {
      number: 'Commande',
      created: 'Créée le',
      patient: 'Patient',
      dentist: 'Dentiste',
      lab: 'Laboratoire',
      items: 'Articles',
      status: 'Statut',
      priority: 'Priorité',
      sent: 'Envoyée',
      expected: 'Attendue',
      received: 'Reçue',
      appointment: 'Rendez-vous',
      cost: 'Coût',
    },
    kinds: {
      opening: 'Solde d’ouverture',
      order: 'Commande livrée',
      remake: 'Frais de reprise',
      cancellation: 'Frais d’annulation',
      adjustment: 'Ajustement',
      payment: 'Paiement',
    },
    statuses: {
      to_send: 'À envoyer',
      at_lab: 'Au laboratoire',
      arrived: 'Arrivée',
      done: 'Terminée',
      on_hold: 'En attente',
      remake: 'Reprise',
      cancelled: 'Annulée',
    },
    urgent: 'Urgent',
    methods: {
      cash: 'Espèces',
      card: 'Carte',
      bank_transfer: 'Virement',
      whish: 'Whish',
      insurance: 'Assurance',
    },
    voided: 'Annulé',
  },
};
