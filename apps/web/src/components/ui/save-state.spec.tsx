import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@/lib/i18n';
import { SaveState } from './save-state';

describe('SaveState', () => {
  afterEach(() => {
    cleanup();
  });

  it('tells an autosaved group that it saves as you type while idle', () => {
    render(<SaveState status="idle" onRetry={() => undefined} />);
    expect(screen.getByRole('status').textContent).toBe('Autosaves as you type');
  });

  it('still shows nothing for a clean explicitly saved form', () => {
    render(<SaveState status="clean" onRetry={() => undefined} />);
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
