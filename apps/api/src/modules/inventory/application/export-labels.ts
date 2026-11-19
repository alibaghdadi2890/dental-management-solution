import type {
  ExportLanguage,
  InventoryCategoryKey,
  PaymentMethod,
  StockLabelKind,
  SupplierStatementKind,
} from '@dcm/contracts';
import { INVENTORY_PACK_KEYS, INVENTORY_UNIT_KEYS } from '@dcm/contracts';

/** The words of the inventory CSV exports, per language (the SPA's `inventory` strings). */
export interface InventoryExportLabels {
  stock: {
    name: string;
    code: string;
    category: string;
    unit: string;
    onHand: string;
    reorderLevel: string;
    status: string;
    value: string;
  };
  statement: {
    date: string;
    kind: string;
    receipt: string;
    description: string;
    method: string;
    amount: string;
    balance: string;
    status: string;
    balanceBefore: string;
  };
  categories: Record<InventoryCategoryKey, string>;
  units: Record<
    (typeof INVENTORY_UNIT_KEYS)[number] | (typeof INVENTORY_PACK_KEYS)[number],
    string
  >;
  labels: Record<StockLabelKind, string>;
  kinds: Record<SupplierStatementKind, string>;
  methods: Record<PaymentMethod, string>;
  voided: string;
}

export const INVENTORY_EXPORT_LABELS: Record<ExportLanguage, InventoryExportLabels> = {
  en: {
    stock: {
      name: 'Item',
      code: 'Code',
      category: 'Category',
      unit: 'Unit',
      onHand: 'On hand',
      reorderLevel: 'Reorder level',
      status: 'Status',
      value: 'Value',
    },
    statement: {
      date: 'Date',
      kind: 'Entry',
      receipt: 'Receipt',
      description: 'Description',
      method: 'Method',
      amount: 'Amount',
      balance: 'Balance',
      status: 'Status',
      balanceBefore: 'Balance before the period',
    },
    categories: {
      anaesthetics: 'Anaesthetics',
      restorative: 'Restorative',
      endodontics: 'Endodontics',
      prosthetics_impression: 'Prosthetics & impression',
      surgery_implants: 'Surgery & implants',
      orthodontics: 'Orthodontics',
      hygiene_prevention: 'Hygiene & prevention',
      sterilisation: 'Sterilisation & infection control',
      disposables: 'Disposables',
      instruments_burs: 'Instruments & burs',
      imaging: 'Imaging',
      office_cleaning: 'Office & cleaning',
    },
    units: {
      piece: 'piece',
      carpule: 'carpule',
      tube: 'tube',
      bottle: 'bottle',
      syringe: 'syringe',
      pair: 'pair',
      sheet: 'sheet',
      box: 'box',
      pack: 'pack',
      bag: 'bag',
      roll: 'roll',
      kit: 'kit',
    },
    labels: {
      out: 'Out',
      expired: 'Expired',
      low: 'Low',
      expiring: 'Expiring',
      ordered: 'Ordered',
      to_count: 'To count',
    },
    kinds: {
      opening: 'Opening balance',
      receipt: 'Receipt',
      adjustment: 'Adjustment',
      payment: 'Payment',
    },
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
    stock: {
      name: 'الصنف',
      code: 'الرمز',
      category: 'الفئة',
      unit: 'الوحدة',
      onHand: 'المتوفر',
      reorderLevel: 'حد إعادة الطلب',
      status: 'الحالة',
      value: 'القيمة',
    },
    statement: {
      date: 'التاريخ',
      kind: 'القيد',
      receipt: 'الاستلام',
      description: 'الوصف',
      method: 'الطريقة',
      amount: 'المبلغ',
      balance: 'الرصيد',
      status: 'الحالة',
      balanceBefore: 'الرصيد قبل الفترة',
    },
    categories: {
      anaesthetics: 'التخدير',
      restorative: 'الترميم',
      endodontics: 'علاج العصب',
      prosthetics_impression: 'التركيبات والطبعات',
      surgery_implants: 'الجراحة والزرعات',
      orthodontics: 'التقويم',
      hygiene_prevention: 'الصحة والوقاية',
      sterilisation: 'التعقيم ومكافحة العدوى',
      disposables: 'المستهلكات',
      instruments_burs: 'الأدوات والسنابل',
      imaging: 'التصوير',
      office_cleaning: 'المكتب والتنظيف',
    },
    units: {
      piece: 'قطعة',
      carpule: 'أمبولة',
      tube: 'أنبوب',
      bottle: 'زجاجة',
      syringe: 'محقنة',
      pair: 'زوج',
      sheet: 'ورقة',
      box: 'علبة',
      pack: 'رزمة',
      bag: 'كيس',
      roll: 'لفة',
      kit: 'طقم',
    },
    labels: {
      out: 'نفد',
      expired: 'منتهي الصلاحية',
      low: 'منخفض',
      expiring: 'تنتهي صلاحيته',
      ordered: 'مطلوب',
      to_count: 'للجرد',
    },
    kinds: {
      opening: 'رصيد افتتاحي',
      receipt: 'استلام',
      adjustment: 'تسوية',
      payment: 'دفعة',
    },
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
    stock: {
      name: 'Article',
      code: 'Code',
      category: 'Catégorie',
      unit: 'Unité',
      onHand: 'En stock',
      reorderLevel: 'Seuil de commande',
      status: 'État',
      value: 'Valeur',
    },
    statement: {
      date: 'Date',
      kind: 'Écriture',
      receipt: 'Réception',
      description: 'Description',
      method: 'Moyen',
      amount: 'Montant',
      balance: 'Solde',
      status: 'État',
      balanceBefore: 'Solde avant la période',
    },
    categories: {
      anaesthetics: 'Anesthésiques',
      restorative: 'Restauration',
      endodontics: 'Endodontie',
      prosthetics_impression: 'Prothèse et empreinte',
      surgery_implants: 'Chirurgie et implants',
      orthodontics: 'Orthodontie',
      hygiene_prevention: 'Hygiène et prévention',
      sterilisation: 'Stérilisation et hygiène',
      disposables: 'Consommables',
      instruments_burs: 'Instruments et fraises',
      imaging: 'Imagerie',
      office_cleaning: 'Bureau et nettoyage',
    },
    units: {
      piece: 'pièce',
      carpule: 'carpule',
      tube: 'tube',
      bottle: 'flacon',
      syringe: 'seringue',
      pair: 'paire',
      sheet: 'feuille',
      box: 'boîte',
      pack: 'paquet',
      bag: 'sachet',
      roll: 'rouleau',
      kit: 'kit',
    },
    labels: {
      out: 'Rupture',
      expired: 'Périmé',
      low: 'Bas',
      expiring: 'Bientôt périmé',
      ordered: 'Commandé',
      to_count: 'À compter',
    },
    kinds: {
      opening: 'Solde d’ouverture',
      receipt: 'Réception',
      adjustment: 'Ajustement',
      payment: 'Paiement',
    },
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

/** Every translation of the predefined categories: a custom one may not take any of them. */
export const KEYED_CATEGORY_NAMES: readonly string[] = Object.values(
  INVENTORY_EXPORT_LABELS,
).flatMap((labels) => Object.values(labels.categories));

/** The predefined category whose name in any language is `name`, if any. */
export function categoryKeyByName(name: string): InventoryCategoryKey | null {
  const wanted = name.trim().toLocaleLowerCase();
  for (const labels of Object.values(INVENTORY_EXPORT_LABELS)) {
    for (const [key, label] of Object.entries(labels.categories)) {
      if (label.toLocaleLowerCase() === wanted) return key as InventoryCategoryKey;
    }
  }
  return null;
}

/** A unit or pack word in the export's language: a key is translated, a clinic's word is kept. */
export function unitWord(labels: InventoryExportLabels, word: string): string {
  return (labels.units as Record<string, string>)[word] ?? word;
}
