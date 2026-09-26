import { useTranslation } from 'react-i18next';
import { Button } from './button';

/** Catalog-style sticky save bar: "N unsaved changes · Discard · Save changes". */
export function SaveBar({
  label,
  error,
  saving,
  onDiscard,
  onSave,
}: {
  label: string;
  error?: string | undefined;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation('common');
  return (
    <div
      role="region"
      aria-label={label}
      className="flex flex-none items-center gap-3 border-t border-border bg-surface px-[26px] py-3 shadow-[0_-6px_20px_rgba(27,26,31,.06)]"
    >
      <span className="size-2 rounded-full bg-warning-dot" />
      <span className="text-[13px] leading-tight font-medium">{label}</span>
      {error && (
        <span className="text-[12.5px] leading-tight font-medium text-danger">{error}</span>
      )}
      <div className="ms-auto flex gap-2">
        <Button onClick={onDiscard} disabled={saving}>
          {t('discard')}
        </Button>
        <Button variant="primary" onClick={onSave} busy={saving} disabled={error !== undefined}>
          {saving ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  );
}
