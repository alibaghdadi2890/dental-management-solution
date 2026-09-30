import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { LanguageSwitch } from './language-switch';

function Harness() {
  const { t } = useTranslation('shell');
  return (
    <>
      <p>{t('user.signOut')}</p>
      <LanguageSwitch label={t('user.language')} />
    </>
  );
}

const openMenu = (name: string) => {
  fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false });
};

describe('LanguageSwitch', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('lists each language in its own name, the current one checked', async () => {
    render(<Harness />);
    openMenu('Language');

    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual(['English', 'العربية', 'Français']);
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(items[1]?.querySelector('[lang="ar"]')?.getAttribute('dir')).toBe('rtl');
  });

  it('switches the language: the strings, <html lang dir> and the stored choice follow', async () => {
    render(<Harness />);
    openMenu('Language');
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'العربية' }));

    await screen.findByText('تسجيل الخروج');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(localStorage.getItem('i18nextLng')).toBe('ar');

    openMenu('اللغة');
    await waitFor(() => {
      expect(
        screen.getByRole('menuitemradio', { name: 'العربية' }).getAttribute('aria-checked'),
      ).toBe('true');
    });
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Français' }));

    await screen.findByText('Se déconnecter');
    expect(document.documentElement.lang).toBe('fr');
    expect(document.documentElement.dir).toBe('ltr');
  });
});
