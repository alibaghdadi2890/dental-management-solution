import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useToothSelectionState } from './tooth-selection';

describe('useToothSelectionState', () => {
  it('toggles pending surfaces, and selecting a tooth clears them (spec invariant 9)', () => {
    const { result } = renderHook(() => useToothSelectionState());
    act(() => {
      result.current.select('16');
    });
    act(() => {
      result.current.toggleSurface('O');
      result.current.toggleSurface('M');
      result.current.toggleSurface('O');
    });
    expect(result.current.surfaces).toEqual(['M']);

    act(() => {
      result.current.select('17');
    });
    expect(result.current.tooth).toBe('17');
    expect(result.current.surfaces).toEqual([]);

    act(() => {
      result.current.toggleSurface('D');
      result.current.select(null);
    });
    expect(result.current.tooth).toBeNull();
    expect(result.current.surfaces).toEqual([]);
  });

  it('ensureSelected keeps the pending surfaces of the tooth already selected', () => {
    const { result } = renderHook(() => useToothSelectionState());
    act(() => {
      result.current.select('16');
    });
    act(() => {
      result.current.toggleSurface('O');
    });
    act(() => {
      result.current.ensureSelected('16');
    });
    expect(result.current.surfaces).toEqual(['O']);
    act(() => {
      result.current.ensureSelected('17');
    });
    expect(result.current).toMatchObject({ tooth: '17', surfaces: [] });
  });
});
