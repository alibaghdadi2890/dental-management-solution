import type { MedicalItem, MedicalOptionKind } from '@dcm/contracts';
import { type KeyboardEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { Suggestions } from './history-model';

const PILL: Record<MedicalOptionKind, string> = {
  allergy: 'border-danger-border bg-danger-bg text-danger',
  condition: 'border-warning-border bg-warning-bg text-warning',
};

type Row = { key: string; item: MedicalItem } | { key: 'create'; create: string };

/**
 * One list of a medical history — allergies or conditions — as a box of pills with a text field
 * in it (feature 10, V3, V13). Typing suggests the clinic's names for that list; a click or
 * Enter adds the suggestion as a pill, the text clears and the caret stays in the box for the
 * next one. A name the clinic does not offer yet is added with **Add “…”**, and is suggested
 * from then on. × on a pill, or Backspace in the empty box, removes one. ↑/↓ move through the
 * suggestions and Escape closes them, dropping the text. Text left in the box when it loses the
 * focus is added as typed, so an allergy is never lost to a missed Enter. **None known** /
 * **None** beside the label is the explicit answer; adding a pill takes it back.
 *
 * The field holds no history: it shows `pills` and asks its parent for `suggest(text)`.
 */
export function ItemsField({
  kind,
  label,
  noneLabel,
  placeholder,
  none,
  pills,
  suggest,
  disabled,
  busy,
  onNone,
  onAdd,
  onCreate,
  onRemove,
}: {
  kind: MedicalOptionKind;
  label: string;
  noneLabel: string;
  placeholder: string;
  none: boolean;
  pills: readonly MedicalItem[];
  suggest: (text: string) => Suggestions;
  disabled: boolean;
  /** A new name is being added: the box waits for it. */
  busy: boolean;
  onNone: () => void;
  onAdd: (id: string) => void;
  onCreate: (name: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation('patients');
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${String(index)}`;

  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const suggestions = suggest(text);
  const rows: Row[] = [
    ...suggestions.options.map((item) => ({ key: item.id, item })),
    ...(suggestions.create === null
      ? []
      : [{ key: 'create' as const, create: suggestions.create }]),
  ];
  const open = focused && !dismissed && !disabled && rows.length > 0;

  // Nothing is marked while nothing is typed: Enter in an empty box adds nothing.
  const [cursor, setCursor] = useState({ text, index: -1 });
  const resting = text.trim() === '' ? -1 : 0;
  const active = Math.min(cursor.text === text ? cursor.index : resting, rows.length - 1);

  const type = (next: string) => {
    setText(next);
    setDismissed(false);
  };

  const pick = (row: Row) => {
    if (busy) return;
    if ('item' in row) onAdd(row.item.id);
    else onCreate(row.create);
    type('');
  };

  /** Leaving the box with text in it: that name, as typed, and never a guess from a prefix. */
  const commitTyped = () => {
    const typed = text.trim().toLowerCase();
    if (typed === '') return;
    const named = rows.find((row) => 'item' in row && row.item.name.toLowerCase() === typed);
    const create = rows.find((row) => 'create' in row);
    const row = named ?? create;
    if (row) pick(row);
    else type('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // An input method (Arabic, CJK…) uses Enter and the arrows for its own candidates.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no standard replacement
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      if (!open && text === '') return;
      // Closes the suggestions, not the panel around the field.
      event.preventDefault();
      setText('');
      setDismissed(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setDismissed(false);
      if (rows.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const index = Math.min(Math.max(active + step, 0), rows.length - 1);
      setCursor({ text, index });
      document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'Backspace' && text === '') {
      const last = pills.at(-1);
      if (last) onRemove(last.id);
      return;
    }
    if (event.key !== 'Enter') return;
    const row = open ? rows[active] : undefined;
    // An empty box leaves Enter to the form around it.
    if (!row && text === '') return;
    event.preventDefault();
    if (row) pick(row);
  };

  return (
    <div role="group" aria-labelledby={labelId} data-history-list={kind}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span id={labelId} className="text-[12.5px] leading-none font-medium">
          {label}
        </span>
        <button
          type="button"
          aria-pressed={none}
          disabled={disabled}
          onClick={onNone}
          className={cn(
            'h-6 cursor-pointer rounded-md border px-2 text-[12px] leading-none font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-default disabled:opacity-60',
            none
              ? 'border-primary-tint-border bg-primary-tint text-primary'
              : 'border-border-control bg-surface text-ink-secondary hover:border-ink-muted',
          )}
        >
          {noneLabel}
        </button>
      </div>
      <div className="relative">
        <div
          aria-busy={busy || undefined}
          className={cn(
            'flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-[7px] border border-border-control bg-surface px-1.5 py-1 focus-within:border-primary',
            disabled && 'opacity-60',
          )}
        >
          {pills.length > 0 && (
            <ul aria-label={label} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {pills.map((pill) => (
                <li
                  key={pill.id}
                  className={cn(
                    'inline-flex h-[26px] items-center gap-1 rounded-md border ps-2 text-[12.5px] leading-none font-medium',
                    disabled ? 'pe-2' : 'pe-0.5',
                    PILL[kind],
                  )}
                >
                  {pill.name}
                  {!disabled && (
                    <button
                      type="button"
                      aria-label={t('history.remove', { name: pill.name })}
                      onClick={() => {
                        onRemove(pill.id);
                      }}
                      className="grid size-5 cursor-pointer place-items-center rounded border-0 bg-transparent p-0 text-[14px] leading-none text-current opacity-70 hover:opacity-100"
                    >
                      <span aria-hidden>×</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <input
            role="combobox"
            aria-label={label}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
            value={text}
            maxLength={60}
            disabled={disabled}
            placeholder={pills.length === 0 ? (none ? noneLabel : placeholder) : undefined}
            autoComplete="off"
            onChange={(event) => {
              type(event.target.value);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => {
              setFocused(true);
              setDismissed(false);
            }}
            onBlur={() => {
              setFocused(false);
              commitTyped();
            }}
            className="h-[26px] min-w-[120px] flex-1 border-0 bg-transparent px-1 text-[13px] leading-none text-ink outline-none placeholder:text-ink-muted"
          />
        </div>
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute inset-x-0 top-full z-20 m-0 mt-1 max-h-[212px] list-none overflow-y-auto rounded-lg border border-border bg-surface p-0 py-1 shadow-lg"
          >
            {rows.map((row, index) => (
              <li
                key={row.key}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onMouseMove={() => {
                  if (index !== active) setCursor({ text, index });
                }}
                // Keeps the caret in the box, ready for the next one.
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  pick(row);
                }}
                className={cn(
                  'cursor-pointer px-3 py-[7px] text-[13px] leading-[1.3]',
                  index === active && 'bg-primary-tint/60',
                  'create' in row && 'font-medium text-primary',
                )}
              >
                {'item' in row ? row.item.name : t('history.add', { name: row.create })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
