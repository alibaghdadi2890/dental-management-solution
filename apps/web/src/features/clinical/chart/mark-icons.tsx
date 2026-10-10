import type { MarkIcon } from '@dcm/contracts';
import type { ReactNode } from 'react';

/**
 * The twelve service icons (feature 9, M10): drawn here on a 16 unit grid with 1.5 unit strokes
 * and round joins, so each keeps its shape between 9 and 20 px on a coloured chip. Shapes, not
 * pictures: at chart size the icon only has to differ from the other eleven. They take the
 * current colour.
 */
const ICONS: Record<MarkIcon, ReactNode> = {
  // A cavity filled: a block with a solid core.
  filling: (
    <>
      <rect x="3" y="3" width="10" height="10" rx="2.5" />
      <circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none" />
    </>
  ),
  crown: <path d="M2.8 12.5h10.4M3.6 10 2.8 4.6l3 2.4L8 3.5l2.2 3.5 3-2.4-.8 5.4z" />,
  // A canal running down into two roots.
  root_canal: <path d="M8 2.5v7M8 9.5l-3 4M8 9.5l3 4" />,
  extraction: <path d="m4 4 8 8M12 4l-8 8" />,
  // A threaded post.
  implant: <path d="M8 2.5v11M4.8 5h6.4M5.4 8h5.2M6.2 11h3.6" />,
  // A span carried by two abutments.
  bridge: <path d="M2.5 5h11M4.5 5v7.5M11.5 5v7.5M4.5 9c1.2-1.6 5.8-1.6 7 0" />,
  // A thin shell over the front of the tooth.
  veneer: <path d="M10.5 2.5c-3.2.4-5 2.6-5 5.5s1.8 5.1 5 5.5z" />,
  // A drop.
  sealant: <path d="M8 2.5c2.4 2.9 3.9 4.9 3.9 6.9a3.9 3.9 0 0 1-7.8 0c0-2 1.5-4 3.9-6.9z" />,
  // A core on top of a post.
  post_core: <path d="M8 13.5V7M4.8 7h6.4V3H4.8z" />,
  // An arch of teeth.
  denture: <path d="M2.8 4.5c0 5.4 1.9 8.5 5.2 8.5s5.2-3.1 5.2-8.5zM6 4.5v2.2M10 4.5v2.2" />,
  // A sparkle.
  cleaning: <path d="m8 2.5 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" />,
  // A shine.
  whitening: (
    <>
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1" />
    </>
  ),
};

export function MarkIconGlyph({ icon, size }: { icon: MarkIcon; size: number }) {
  return (
    <svg
      aria-hidden
      data-mark-icon={icon}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
    >
      {ICONS[icon]}
    </svg>
  );
}
