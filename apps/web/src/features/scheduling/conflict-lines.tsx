import type { AppointmentConflict } from '@dcm/contracts';
import { cn } from '@/lib/utils';
import { useConflictWords } from './conflict-words';

export function ConflictLines({ conflicts }: { conflicts: readonly AppointmentConflict[] }) {
  const words = useConflictWords();
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
      {conflicts.map((conflict) => (
        <li
          key={conflict.kind}
          className={cn(
            'flex items-center gap-1.5',
            conflict.hard ? 'text-danger' : 'text-warning',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-[7px] flex-none rounded-full',
              conflict.hard ? 'bg-danger' : 'bg-warning-dot',
            )}
          />
          {words.of(conflict)}
        </li>
      ))}
    </ul>
  );
}
