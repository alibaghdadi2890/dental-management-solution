import type { FileCategory, PatientFile } from '@dcm/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useToothLabel } from '@/features/clinical/chart/use-chart-settings';
import { cn } from '@/lib/utils';
import { glyphOf, useFileText } from './file-text';
import { rotationStyle } from './rotation';

/** A category as a 12px mark: film for an X-ray, a camera for a photo, a page for the rest. */
export function CategoryIcon({ category }: { category: FileCategory }) {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {category === 'xray' ? (
        <>
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M5 3v10M11 3v10M2 8h3M11 8h3" />
        </>
      ) : category === 'photo' ? (
        <>
          <path d="M2 5.5h2.5l1-1.5h5l1 1.5H14V13H2z" />
          <circle cx="8" cy="9" r="2.3" />
        </>
      ) : (
        <>
          <path d="M4 2h5.5l3 3v9H4z" />
          <path d="M9.5 2v3h3" />
        </>
      )}
    </svg>
  );
}

/**
 * What a file looks like in a square: its thumbnail — turned by the stored orientation (F8), on a
 * dark ground for an X-ray so it reads correctly — or, without one, a typed tile: the kind of
 * document in Mono and, when there is room, its filename.
 */
export function FileThumb({
  file,
  showName = false,
  className,
}: {
  file: PatientFile;
  /** The filename under the glyph of a file without a thumbnail (the gallery's tiles). */
  showName?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('files');
  if (file.thumbnailUrl !== null) {
    return (
      <span
        className={cn(
          'block size-full overflow-hidden',
          file.category === 'xray' ? 'bg-[#16151a]' : 'bg-subtle',
          className,
        )}
      >
        <img
          src={file.thumbnailUrl}
          alt=""
          loading="lazy"
          draggable={false}
          className="size-full object-cover"
          style={rotationStyle(file.orientation)}
        />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex size-full flex-col items-center justify-center gap-1.5 bg-faint px-2 text-center',
        className,
      )}
    >
      <span className="rounded-[5px] border border-border-strong bg-surface px-1.5 py-1 font-mono text-[11.5px] leading-none font-semibold text-ink-secondary">
        {t(`glyph.${glyphOf(file)}`)}
      </span>
      {showName && (
        <span
          dir="auto"
          className="line-clamp-2 text-[11.5px] leading-[1.3] break-all text-ink-secondary"
        >
          {file.originalFilename}
        </span>
      )}
    </span>
  );
}

const TILE_SIZE = {
  /** The tooth panel's row. */
  xs: 'size-12 rounded-md',
  /** The upload panel and the Overview card. */
  sm: 'size-16 rounded-lg',
  /** The visit strip. */
  md: 'size-[72px] rounded-lg',
  /** The gallery: as wide as its grid cell. */
  fill: 'aspect-square w-full rounded-[10px]',
} as const;

/**
 * A file as a button that opens it: the thumbnail, and on it — where the size allows — the
 * category mark, the tooth chip, the visit dot, the Archived badge, and the note on hover. Its
 * accessible name says all of that in words.
 */
export function FileTile({
  file,
  size,
  onOpen,
  highlighted = false,
  children,
}: {
  file: PatientFile;
  size: keyof typeof TILE_SIZE;
  onOpen: () => void;
  /** A ring that fades, for a file that was just added. */
  highlighted?: boolean;
  /** Controls laid over the tile (the gallery's checkbox and ⋯ menu). */
  children?: ReactNode;
}) {
  const { t } = useTranslation('files');
  const text = useFileText();
  const toothLabel = useToothLabel();
  const archived = file.archivedAt !== null;
  const rich = size === 'fill' || size === 'md';
  const note = file.note.split('\n')[0] ?? '';

  return (
    <span className={cn('group/tile relative block flex-none', size === 'fill' && 'w-full')}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={text.describe(file)}
        title={note === '' ? undefined : note}
        className={cn(
          'relative block cursor-pointer overflow-hidden border border-border bg-surface p-0 hover:border-primary',
          TILE_SIZE[size],
          highlighted && 'animate-arrive',
          archived && 'opacity-55',
        )}
      >
        <FileThumb file={file} showName={size === 'fill'} />
        {rich && file.thumbnailUrl !== null && (
          <span className="absolute start-1.5 top-1.5 grid size-5 place-items-center rounded-[5px] bg-[rgba(27,26,31,.62)] text-white">
            <CategoryIcon category={file.category} />
          </span>
        )}
        {rich && file.visitId !== null && (
          <span
            title={t('linkedToVisit')}
            className="absolute end-1.5 top-1.5 size-2 rounded-full border border-white bg-primary"
          />
        )}
        {rich && file.toothCode !== null && (
          <span
            dir="ltr"
            className="absolute start-1.5 bottom-1.5 rounded-[5px] bg-[rgba(27,26,31,.72)] px-1.5 py-[3px] font-mono text-[11.5px] leading-none font-medium text-white"
          >
            {toothLabel(file.toothCode)}
          </span>
        )}
        {size === 'fill' && note !== '' && (
          <span className="absolute inset-x-0 bottom-0 hidden truncate bg-[rgba(27,26,31,.78)] px-2 py-1.5 text-start text-[11.5px] leading-none text-white group-hover/tile:block group-focus-within/tile:block">
            {note}
          </span>
        )}
        {archived && size === 'fill' && (
          <span className="absolute end-1.5 bottom-1.5 rounded-[5px] border border-border bg-subtle px-1.5 py-[3px] text-[11.5px] leading-none font-medium text-ink-secondary">
            {t('archivedBadge')}
          </span>
        )}
      </button>
      {children}
    </span>
  );
}
