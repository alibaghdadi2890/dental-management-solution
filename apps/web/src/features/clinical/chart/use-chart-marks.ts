import type { CatalogMark, PatientChart } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { diagnosesQuery, servicesQuery } from '../catalog/catalog-api';

/**
 * The chart marks to derive a patient's chart with (feature 9): the ones the chart read carries
 * — every catalog item its records point at, inactive and deleted ones included — and, for any
 * item it does not have, the catalogs when they are already in the cache. That gap is a service
 * or diagnosis added in the live visit since the chart was read: it is coloured at once. Where
 * both know an item the chart read wins: it is read again far more often than the catalogs.
 * Nothing is fetched here.
 */
export function useChartMarks(chart: PatientChart | undefined): ReadonlyMap<string, CatalogMark> {
  const services = useQuery({ ...servicesQuery(), enabled: false }).data;
  const diagnoses = useQuery({ ...diagnosesQuery(), enabled: false }).data;
  return useMemo(() => {
    const marks = new Map<string, CatalogMark>();
    for (const item of services ?? []) {
      marks.set(item.id, {
        color: item.color,
        icon: item.icon,
        priority: item.markPriority,
        name: item.name,
        code: item.code,
        active: item.active,
      });
    }
    for (const item of diagnoses ?? []) {
      marks.set(item.id, {
        color: item.color,
        icon: null,
        priority: item.markPriority,
        name: item.name,
        code: item.code,
        active: item.active,
      });
    }
    for (const [id, mark] of Object.entries(chart?.marks ?? {})) marks.set(id, mark);
    return marks;
  }, [chart, services, diagnoses]);
}
