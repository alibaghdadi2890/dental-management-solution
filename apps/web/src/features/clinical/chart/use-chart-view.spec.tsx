import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@/lib/i18n';
import { ChartViewSwitch } from './chart-view-switch';
import { setChartView, useChartView } from './use-chart-view';

const STORAGE_KEY = 'dcm.chartView';

describe('useChartView', () => {
  afterEach(() => {
    cleanup();
    setChartView('both');
  });

  it('is Both until chosen, and keeps the choice for the next visit', () => {
    const { result } = renderHook(() => useChartView());
    expect(result.current[0]).toBe('both');
    act(() => {
      result.current[1]('diagnoses');
    });
    expect(result.current[0]).toBe('diagnoses');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('diagnoses');
  });

  it('switches every chart on screen at once', () => {
    const first = renderHook(() => useChartView());
    const second = renderHook(() => useChartView());
    act(() => {
      first.result.current[1]('services');
    });
    expect(second.result.current[0]).toBe('services');
  });

  it('follows a switch made in another tab, and ignores a value it does not know', () => {
    const { result } = renderHook(() => useChartView());
    act(() => {
      localStorage.setItem(STORAGE_KEY, 'services');
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    });
    expect(result.current[0]).toBe('services');
    act(() => {
      localStorage.setItem(STORAGE_KEY, 'everything');
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    });
    expect(result.current[0]).toBe('both');
  });
});

describe('ChartViewSwitch', () => {
  afterEach(() => {
    cleanup();
    setChartView('both');
  });

  it('is a radio group whose checked option is the one Tab stop', () => {
    render(<ChartViewSwitch />);
    const group = screen.getByRole('radiogroup', { name: 'Show on the chart' });
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.textContent)).toEqual(['Diagnoses', 'Services', 'Both']);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, -1, 0]);
    expect(group.contains(radios[0] ?? null)).toBe(true);
  });

  it('selects on click, and the arrows cycle through the options, moving focus', () => {
    render(<ChartViewSwitch />);
    const radio = (name: string) => screen.getByRole('radio', { name });
    fireEvent.click(radio('Diagnoses'));
    expect(radio('Diagnoses').getAttribute('aria-checked')).toBe('true');

    fireEvent.keyDown(radio('Diagnoses'), { key: 'ArrowRight' });
    expect(radio('Services').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio('Services'));

    fireEvent.keyDown(radio('Services'), { key: 'ArrowRight' });
    fireEvent.keyDown(radio('Both'), { key: 'ArrowRight' });
    expect(radio('Diagnoses').getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(radio('Diagnoses'), { key: 'ArrowLeft' });
    expect(radio('Both').getAttribute('aria-checked')).toBe('true');
  });
});
