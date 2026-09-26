import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { signInFailure } from './sign-in-failure';
import { SignInForm } from './sign-in-form';

const problem = (code: string, extra: object = {}) =>
  new ApiError({ type: `urn:dcm:problem:${code}`, title: 'x', status: 401, code, ...extra });

function renderForm(submit = vi.fn(() => Promise.resolve())) {
  const onSignedIn = vi.fn();
  render(<SignInForm submit={submit} onSignedIn={onSignedIn} />);
  const fill = (email: string, password: string) => {
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  };
  const submitButton = () => screen.getByRole('button', { name: /sign in|locked/i });
  return { submit, onSignedIn, fill, submitButton };
}

describe('signInFailure', () => {
  it('reads attempts left and lock expiry from the problem', () => {
    expect(signInFailure(problem('auth.invalid_credentials', { attemptsLeft: 3 }))).toEqual({
      kind: 'invalid',
      attemptsLeft: 3,
    });
    expect(
      signInFailure(problem('auth.account_locked', { lockedUntil: '2026-09-26T10:15:00.000Z' })),
    ).toEqual({ kind: 'locked', lockedUntil: new Date('2026-09-26T10:15:00.000Z') });
    expect(signInFailure(new Error('offline'))).toEqual({ kind: 'generic' });
  });
});

describe('SignInForm', () => {
  afterEach(() => {
    cleanup();
  });

  it('asks for both fields before calling the API', async () => {
    const { submit, submitButton } = renderForm();
    fireEvent.click(submitButton());
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Enter your email and password.',
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('normalises the email and trusts the workstation by default', async () => {
    const { submit, onSignedIn, fill, submitButton } = renderForm();
    fill('  Ana@Clinic.com ', 'secret-pass');
    fireEvent.click(submitButton());
    await vi.waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledWith('secret-pass');
    });
    expect(submit).toHaveBeenCalledWith({
      email: 'ana@clinic.com',
      password: 'secret-pass',
      rememberMe: true,
    });
  });

  it('shows how many attempts are left', async () => {
    const { fill, submitButton } = renderForm(
      vi.fn(() => Promise.reject(problem('auth.invalid_credentials', { attemptsLeft: 3 }))),
    );
    fill('ana@clinic.com', 'wrong');
    fireEvent.click(submitButton());
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Email or password is incorrect. 3 attempts left.',
    );
  });

  it('greys out the button while the account is locked', async () => {
    const lockedUntil = new Date(Date.now() + 14 * 60_000 + 5_000).toISOString();
    const { fill, submitButton } = renderForm(
      vi.fn(() => Promise.reject(problem('auth.account_locked', { lockedUntil }))),
    );
    fill('ana@clinic.com', 'wrong');
    fireEvent.click(submitButton());
    expect((await screen.findByRole('alert')).textContent).toContain('locked for 15 minutes');
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    expect(submitButton().textContent).toContain('Locked — try again in 15 min');
  });
});
