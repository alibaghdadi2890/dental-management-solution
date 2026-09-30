import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { useSurfaceLabel } from './use-chart-settings';

describe('useSurfaceLabel', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('shows the stored letters with their names, joined by the POC separator', () => {
    const { result } = renderHook(() => useSurfaceLabel());

    expect(result.current.short('B')).toBe('B');
    expect(result.current.name('O')).toBe('Occlusal');
    expect(result.current.format(['O', 'D'])).toBe('O · D');
    expect(result.current.format([])).toBe('');
  });

  it('shows V for buccal in French and keeps the Latin letters in Arabic', async () => {
    await i18n.changeLanguage('fr');
    const french = renderHook(() => useSurfaceLabel());
    expect(french.result.current.format(['M', 'B', 'O'])).toBe('M · V · O');
    expect(french.result.current.name('B')).toBe('Vestibulaire');
    cleanup();

    await i18n.changeLanguage('ar');
    const arabic = renderHook(() => useSurfaceLabel());
    expect(arabic.result.current.format(['M', 'B', 'O'])).toBe('M · B · O');
  });
});
