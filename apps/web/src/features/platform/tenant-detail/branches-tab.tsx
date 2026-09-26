import type { Branch, Room } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/list';
import { SaveBar } from '@/components/ui/save-bar';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import {
  branchesQuery,
  platformKeys,
  roomsQuery,
  saveRooms,
  updateBranch,
} from '@/features/platform/platform-api';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  addRoom,
  type BranchesDraft,
  changesOf,
  type DraftRoom,
  draftFrom,
  editRoom,
  isRoomChanged,
  removeRoom,
  setBranchActive,
} from './rooms-draft';

const ROW = 'grid grid-cols-[110px_minmax(0,1fr)_48px_72px] items-center gap-2.5';
const cell = 'h-8 w-full rounded-md border border-border bg-surface px-2';

let newKey = 0;

function RoomRow({
  room,
  changed,
  invalid,
  onChange,
  onRemove,
}: {
  room: DraftRoom;
  changed: boolean;
  invalid: boolean;
  onChange: (patch: Partial<Pick<DraftRoom, 'name' | 'code' | 'active'>>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('admin');
  return (
    <div
      className={cn(
        ROW,
        'min-h-[50px] border-t border-row-divider px-3.5 py-1.5',
        changed ? 'bg-dirty' : 'bg-surface',
        !room.active && 'opacity-60',
      )}
    >
      <input
        aria-label={t('branches.code')}
        value={room.code}
        onChange={(event) => {
          onChange({ code: event.target.value });
        }}
        className={cn(cell, 'font-mono text-[12.5px] leading-none font-medium')}
      />
      <input
        aria-label={t('branches.name')}
        aria-invalid={invalid}
        value={room.name}
        placeholder={room.id === undefined ? t('branches.rooms.newName') : undefined}
        onChange={(event) => {
          onChange({ name: event.target.value });
        }}
        className={cn(cell, 'text-[13px] leading-none font-medium', invalid && 'border-danger')}
      />
      <Switch
        checked={room.active}
        label={t('branches.active')}
        onCheckedChange={(active) => {
          onChange({ active });
        }}
      />
      <span className="flex items-center justify-end gap-1.5">
        {changed && <span className="size-[7px] rounded-full bg-warning-dot" />}
        {(room.id === undefined || room.active) && (
          <IconButton
            aria-label={
              room.id === undefined
                ? t('branches.rooms.remove')
                : t('branches.rooms.delete', { name: room.name })
            }
            onClick={onRemove}
            className="text-danger hover:border-danger-border hover:bg-danger-bg hover:text-danger"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />
            </svg>
          </IconButton>
        )}
      </span>
    </div>
  );
}

function BranchCard({
  branch,
  active,
  rooms,
  original,
  showErrors,
  onBranchActive,
  onAddRoom,
  onRoomChange,
  onRoomRemove,
}: {
  branch: Branch;
  active: boolean;
  rooms: DraftRoom[];
  original: BranchesDraft;
  showErrors: boolean;
  onBranchActive: (active: boolean) => void;
  onAddRoom: () => void;
  onRoomChange: (key: string, patch: Partial<Pick<DraftRoom, 'name' | 'code' | 'active'>>) => void;
  onRoomRemove: (key: string) => void;
}) {
  const { t } = useTranslation('admin');
  const details = [branch.address, branch.phone].filter(Boolean).join(' · ');
  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border border-border',
        active !== branch.active ? 'bg-dirty' : 'bg-surface',
      )}
    >
      <header className="flex flex-wrap items-center gap-3 px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm leading-tight font-semibold">{branch.name}</h3>
            {branch.code && (
              <span className="rounded-sm bg-subtle px-1.5 py-[3px] font-mono text-[11.5px] leading-none text-ink-tertiary">
                {branch.code}
              </span>
            )}
          </div>
          <div className="mt-1 text-[12.5px] leading-snug text-ink-tertiary">
            {details || t('branches.noDetails')}
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] font-medium text-ink-secondary">
          {t('branches.active')}
          <Switch checked={active} label={t('branches.active')} onCheckedChange={onBranchActive} />
        </label>
        <Button size="sm" variant="outline" onClick={onAddRoom}>
          {t('branches.addRoom')}
        </Button>
      </header>
      <div className={cn(ROW, 'h-9 border-t border-border bg-faint px-3.5')}>
        {[t('branches.code'), t('branches.name'), t('branches.active'), ''].map((label, index) => (
          <span
            key={index}
            className="text-[11.5px] leading-none font-medium tracking-[0.05em] text-ink-muted uppercase"
          >
            {label}
          </span>
        ))}
      </div>
      {rooms.length === 0 ? (
        <p className="border-t border-row-divider px-3.5 py-4 text-[12.5px] text-ink-tertiary">
          {t('branches.rooms.empty')}
        </p>
      ) : (
        rooms.map((room) => (
          <RoomRow
            key={room.key}
            room={room}
            changed={isRoomChanged(original, room)}
            invalid={showErrors && room.name.trim() === ''}
            onChange={(patch) => {
              onRoomChange(room.key, patch);
            }}
            onRemove={() => {
              onRoomRemove(room.key);
            }}
          />
        ))
      )}
    </section>
  );
}

function roomConflict(
  error: unknown,
  t: (key: 'branches.conflict.nameTaken' | 'branches.conflict.codeTaken') => string,
) {
  if (error instanceof ApiError && error.code === 'room.name_taken')
    return t('branches.conflict.nameTaken');
  if (error instanceof ApiError && error.code === 'room.code_taken')
    return t('branches.conflict.codeTaken');
  return error instanceof Error ? error.message : String(error);
}

function BranchesEditor({
  tenantId,
  branches,
  rooms,
  onAddBranch,
}: {
  tenantId: string;
  branches: Branch[];
  rooms: Room[];
  onAddBranch: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const original = useMemo(() => draftFrom(branches, rooms), [branches, rooms]);
  const [draft, setDraft] = useState(original);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const changes = changesOf(original, draft);

  const save = async () => {
    if (changes.missingNames) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      for (const branch of changes.branches) {
        await updateBranch(tenantId, branch.id, branch.patch);
      }
      if (changes.rooms.length > 0) {
        await saveRooms(tenantId, { items: changes.rooms });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: platformKeys.branches(tenantId) }),
        queryClient.invalidateQueries({ queryKey: platformKeys.rooms(tenantId) }),
      ]);
      toast(t('branches.saved'));
    } catch (error) {
      toast(t('branches.failed', { reason: roomConflict(error, t) }), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    confirm({
      title: t('branches.discardTitle'),
      body: t('branches.discardBody', { count: changes.count }),
      okLabel: t('common:discard'),
      tone: 'danger',
      onConfirm: () => {
        setDraft(original);
        setShowErrors(false);
      },
    });
  };

  if (branches.length === 0) {
    return (
      <EmptyState
        title={t('branches.empty.title')}
        body={t('branches.empty.body')}
        action={
          <Button variant="primary" onClick={onAddBranch}>
            {t('branches.add')}
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3.5">
        {branches.map((branch) => (
          <BranchCard
            key={branch.id}
            branch={branch}
            active={draft.branchActive[branch.id] ?? branch.active}
            rooms={draft.rooms.filter((room) => room.branchId === branch.id)}
            original={original}
            showErrors={showErrors}
            onBranchActive={(active) => {
              setDraft((current) => setBranchActive(current, branch.id, active));
            }}
            onAddRoom={() => {
              newKey += 1;
              setDraft((current) => addRoom(current, branch.id, `new-${String(newKey)}`));
            }}
            onRoomChange={(key, patch) => {
              setDraft((current) => editRoom(current, key, patch));
            }}
            onRoomRemove={(key) => {
              setDraft((current) => removeRoom(current, key));
            }}
          />
        ))}
        <div>
          <Button onClick={onAddBranch}>{t('branches.add')}</Button>
        </div>
      </div>
      {changes.count > 0 && (
        <div className="sticky bottom-0 -mx-[26px] mt-auto -mb-10 pt-6">
          <SaveBar
            label={t('branches.unsaved', { count: changes.count })}
            error={showErrors && changes.missingNames ? t('branches.missingName') : undefined}
            saving={saving}
            onDiscard={discard}
            onSave={() => void save()}
          />
        </div>
      )}
    </>
  );
}

export function BranchesTab({
  tenantId,
  onAddBranch,
}: {
  tenantId: string;
  onAddBranch: () => void;
}) {
  const { t } = useTranslation('admin');
  const branches = useQuery(branchesQuery(tenantId));
  const rooms = useQuery(roomsQuery(tenantId));

  if (branches.isPending || rooms.isPending) {
    return <SkeletonRows columns="1fr 1fr" rows={3} label={t('detail.loading')} />;
  }
  if (branches.isError || rooms.isError) {
    return (
      <ErrorState
        title={t('detail.error.title')}
        body={t('detail.error.body')}
        onRetry={() => {
          void branches.refetch();
          void rooms.refetch();
        }}
      />
    );
  }
  // Fresh server data (after a save) starts a fresh draft.
  return (
    <BranchesEditor
      key={`${String(branches.dataUpdatedAt)}-${String(rooms.dataUpdatedAt)}`}
      tenantId={tenantId}
      branches={branches.data}
      rooms={rooms.data}
      onAddBranch={onAddBranch}
    />
  );
}
