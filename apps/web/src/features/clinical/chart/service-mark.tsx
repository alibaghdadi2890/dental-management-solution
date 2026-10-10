import { useQuery } from '@tanstack/react-query';
import { servicesQuery } from '../catalog/catalog-api';
import { MarkChip } from './mark-chip';

/**
 * The chart mark of a service, before its name in a list (feature 9): the same chip the tooth
 * carries on the chart, so the list and the chart read alike. Read from the service catalog,
 * which the workspace already holds. A service that is not on a tooth shows no mark, and neither
 * does one removed from the catalog: nothing is drawn for them.
 */
export function ServiceMark({
  procedureId,
  tone = 'past',
  className,
}: {
  procedureId: string;
  /** Done in this visit, or before. */
  tone?: 'today' | 'past';
  className?: string;
}) {
  const item = useQuery(servicesQuery()).data?.find((service) => service.id === procedureId);
  if (!item || item.color === null || item.chargeUnit !== 'per_tooth') return null;
  return (
    <MarkChip
      kind="service"
      color={item.color}
      icon={item.icon}
      tone={tone}
      size={15}
      {...(className !== undefined && { className })}
    />
  );
}
