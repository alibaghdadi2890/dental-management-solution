import type { ReactNode } from 'react';

interface PageProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children?: ReactNode;
}

/** POC list-screen frame: scrolling area, 21px title, subtitle and optional actions. */
export function Page({ title, subtitle, actions, children }: PageProps) {
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-[1320px] px-[26px] pt-6 pb-10">
        <div className="mb-[18px] flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="mb-1 text-[21px] leading-tight font-semibold tracking-[-0.02em]">
              {title}
            </h1>
            <p className="text-[13px] leading-snug text-ink-tertiary">{subtitle}</p>
          </div>
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
