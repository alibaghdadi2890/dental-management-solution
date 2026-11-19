import { idSchema, type ReceiveRequest, receiveSchema } from '@dcm/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { useSession } from '@/features/auth/session';
import { ReceiveForm } from '@/features/inventory/receipt-page';

const searchSchema = z.object({
  branch: idSchema.optional().catch(undefined),
  oneOff: z.literal(true).optional().catch(undefined),
  /** A whole receive input, as JSON: the form opens pre-filled from it (D12, run b's door). */
  draft: z.string().max(20_000).optional().catch(undefined),
});

function draftOf(text: string | undefined): ReceiveRequest | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed = receiveSchema.safeParse(JSON.parse(text));
    return parsed.success ? (JSON.parse(text) as ReceiveRequest) : undefined;
  } catch {
    return undefined;
  }
}

/** Receive (B1): its own page (the owner's layout answer). */
export const Route = createFileRoute('/_app/inventory/receipts/new')({
  staticData: { navKey: 'inventory' },
  validateSearch: searchSchema,
  component: ReceiveRoute,
});

function ReceiveRoute() {
  const search = Route.useSearch();
  const { data: session } = useSession();
  if (!session?.tenant || !session.permissions.includes('inventory:write')) return null;
  const draft = draftOf(search.draft);
  const branchId = search.branch ?? session.branch?.id ?? session.branches[0]?.id ?? '';
  return (
    <TooltipProvider>
      <ReceiveForm
        session={session}
        branchId={branchId}
        draft={draft}
        oneOff={search.oneOff === true}
      />
    </TooltipProvider>
  );
}
