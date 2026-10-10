import { useSyncExternalStore } from 'react';
import { CHART_VIEWS, type ChartView } from './tooth-render';

const STORAGE_KEY = 'dcm.chartView';
const DEFAULT_VIEW: ChartView = 'both';

const listeners = new Set<() => void>();

function parse(value: string | null): ChartView {
  return CHART_VIEWS.find((view) => view === value) ?? DEFAULT_VIEW;
}

function read(): ChartView {
  try {
    return parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_VIEW;
  }
}

/** The view in use. Kept here, not read from storage each time, so a browser that refuses
 * storage (private mode) still switches for the visit. */
let current: ChartView | null = null;

function snapshot(): ChartView {
  current ??= read();
  return current;
}

function subscribe(listener: () => void): () => void {
  // Another tab switched: this one follows.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    current = read();
    listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setChartView(view: ChartView): void {
  current = view;
  try {
    localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // Private mode: the choice holds for this visit only.
  }
  for (const listener of listeners) listener();
}

/**
 * What the dental chart shows — diagnoses, services or both (feature 9, ADR-0043): this browser's
 * choice, kept for the next visit, not a clinic setting. One store for the whole app, so every
 * chart on screen (the workspace card, the record tab, the compact charts) switches together.
 */
export function useChartView(): [ChartView, (view: ChartView) => void] {
  return [useSyncExternalStore(subscribe, snapshot, () => DEFAULT_VIEW), setChartView];
}
