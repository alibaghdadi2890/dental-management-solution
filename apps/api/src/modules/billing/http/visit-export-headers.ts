import type { ExportLanguage } from '@dcm/contracts';
import type { VisitExportLabels } from '../application/visit-views.service';

/** The visits CSV's header row and status values per language (the SPA's `visits` labels). */
const LABELS: Record<ExportLanguage, VisitExportLabels> = {
  en: {
    visit: 'Visit',
    date: 'Date',
    time: 'Time',
    room: 'Room',
    patient: 'Patient',
    patientId: 'Patient ID',
    dentist: 'Dentist',
    services: 'Services',
    subtotal: 'Subtotal',
    discount: 'Discount',
    total: 'Total',
    paid: 'Paid',
    balance: 'Balance',
    status: 'Status',
    statuses: {
      in_progress: 'In progress',
      paused: 'Paused',
      completed: 'Completed',
      amended: 'Amended',
      voided: 'Voided',
    },
  },
  ar: {
    visit: 'الزيارة',
    date: 'التاريخ',
    time: 'الوقت',
    room: 'الغرفة',
    patient: 'المريض',
    patientId: 'رقم المريض',
    dentist: 'الطبيب',
    services: 'الخدمات',
    subtotal: 'المجموع الفرعي',
    discount: 'الخصم',
    total: 'الإجمالي',
    paid: 'المدفوع',
    balance: 'الرصيد',
    status: 'الحالة',
    statuses: {
      in_progress: 'قيد التنفيذ',
      paused: 'متوقفة مؤقتًا',
      completed: 'مكتملة',
      amended: 'معدّلة',
      voided: 'ملغاة',
    },
  },
  fr: {
    visit: 'Visite',
    date: 'Date',
    time: 'Heure',
    room: 'Salle',
    patient: 'Patient',
    patientId: 'N° patient',
    dentist: 'Dentiste',
    services: 'Actes',
    subtotal: 'Sous-total',
    discount: 'Remise',
    total: 'Total',
    paid: 'Payé',
    balance: 'Solde',
    status: 'Statut',
    statuses: {
      in_progress: 'En cours',
      paused: 'En pause',
      completed: 'Terminée',
      amended: 'Modifiée',
      voided: 'Annulée',
    },
  },
};

export function visitExportLabels(locale: ExportLanguage): VisitExportLabels {
  return LABELS[locale];
}
