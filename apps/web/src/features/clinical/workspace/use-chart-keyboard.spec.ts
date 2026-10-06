import type { ChartOrientation, DentitionStage, ToothCode, ToothPresence } from '@dcm/contracts';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChartKeyboard } from './use-chart-keyboard';

interface Setup {
  selected: ToothCode | null;
  orientation?: ChartOrientation;
  dentition?: DentitionStage;
  toothStatus?: ToothPresence[];
  onEscape?: () => void;
}

function setup({
  selected,
  orientation = 'patient_right_on_right',
  dentition = 'permanent',
  onEscape,
}: Setup) {
  const onSelect = vi.fn<(code: ToothCode | null) => void>();
  renderHook(() => {
    useChartKeyboard({ orientation, dentition, selected, onSelect, onEscape });
  });
  return onSelect;
}

const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key });

describe('useChartKeyboard', () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it('walks the upper row, then the lower row, patient right on the right', () => {
    // Upper 28…21, 11…18, then lower 38…31, 41…48.
    const fromUpperLeft = setup({ selected: '28' });
    press('ArrowRight');
    expect(fromUpperLeft).toHaveBeenLastCalledWith('27');

    cleanup();
    const fromUpperEnd = setup({ selected: '18' });
    press('ArrowRight');
    expect(fromUpperEnd).toHaveBeenLastCalledWith('38');

    cleanup();
    const fromLowerStart = setup({ selected: '38' });
    press('ArrowLeft');
    expect(fromLowerStart).toHaveBeenLastCalledWith('18');
  });

  it('wraps at both ends', () => {
    const first = setup({ selected: '28' });
    press('ArrowLeft');
    expect(first).toHaveBeenLastCalledWith('48');

    cleanup();
    const last = setup({ selected: '48' });
    press('ArrowRight');
    expect(last).toHaveBeenLastCalledWith('28');
  });

  it('follows the other orientation: patient right on the left', () => {
    // Upper 18…11, 21…28, then lower 48…41, 31…38.
    const onSelect = setup({ selected: '18', orientation: 'patient_right_on_left' });
    press('ArrowRight');
    expect(onSelect).toHaveBeenLastCalledWith('17');
    press('ArrowLeft');
    // Still selected '18' (the prop didn't change): left of the first tooth wraps to the last.
    expect(onSelect).toHaveBeenLastCalledWith('38');

    cleanup();
    const upperEnd = setup({ selected: '28', orientation: 'patient_right_on_left' });
    press('ArrowRight');
    expect(upperEnd).toHaveBeenLastCalledWith('48');
  });

  it('walks the primary chart’s twenty teeth, wrapping', () => {
    const onSelect = setup({
      selected: '55',
      orientation: 'patient_right_on_left',
      dentition: 'primary',
    });
    press('ArrowRight');
    expect(onSelect).toHaveBeenLastCalledWith('54');
    press('ArrowLeft');
    expect(onSelect).toHaveBeenLastCalledWith('75');
  });

  it('does nothing with the arrows while no tooth is selected', () => {
    const onSelect = setup({ selected: null });
    press('ArrowRight');
    press('ArrowLeft');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Esc deselects, and does nothing without a selection', () => {
    const onSelect = setup({ selected: '16' });
    press('Escape');
    expect(onSelect).toHaveBeenLastCalledWith(null);

    cleanup();
    const none = setup({ selected: null });
    press('Escape');
    expect(none).not.toHaveBeenCalled();
  });

  it('with a layer open, Esc closes it instead of deselecting and the arrows do nothing', () => {
    const onEscape = vi.fn();
    const onSelect = setup({ selected: '16', onEscape });
    press('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    // The selection can't move under the open drawer.
    press('ArrowRight');
    press('ArrowLeft');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes an open layer with Esc even without a selection', () => {
    const onEscape = vi.fn();
    const onSelect = setup({ selected: null, onEscape });
    press('Escape');
    press('ArrowRight');
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves Esc to a layer that already handled it (the topmost closes first)', () => {
    const onSelect = setup({ selected: '16' });
    const layer = document.createElement('div');
    document.body.append(layer);
    layer.addEventListener('keydown', (event) => {
      event.preventDefault();
    });
    press('Escape', layer);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores keys while focus is in a field', () => {
    const onSelect = setup({ selected: '16' });
    const fields = [
      document.createElement('textarea'),
      document.createElement('input'),
      document.createElement('select'),
    ];
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    for (const field of [...fields, editable]) {
      document.body.append(field);
      press('ArrowRight', field);
      press('Escape', field);
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores keys inside a dialog or a menu, and with a modifier', () => {
    const onSelect = setup({ selected: '16' });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(dialog);
    press('ArrowRight', button);
    fireEvent.keyDown(document.body, { key: 'ArrowRight', altKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
