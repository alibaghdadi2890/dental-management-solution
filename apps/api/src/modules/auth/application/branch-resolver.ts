import { Injectable } from '@nestjs/common';
import { TenancyService } from '../../tenancy';
import { IdentityRepository } from '../persistence/identity.repository';

export interface BranchCaller {
  userId: string;
  platformAdmin: boolean;
}

/**
 * Which branches a caller may work in inside the current tenant: the active branches they are
 * assigned to (the team mirror), or every active branch for a platform admin (D7, ADR-0008).
 */
@Injectable()
export class BranchResolver {
  constructor(
    private readonly identities: IdentityRepository,
    private readonly tenancy: TenancyService,
  ) {}

  /** Candidate branch ids, preferred first (oldest assignment / oldest branch). */
  async candidates(caller: BranchCaller, tenantId: string): Promise<string[]> {
    if (caller.platformAdmin) {
      return (await this.tenancy.allActiveBranches()).map((branch) => branch.id);
    }
    const assigned = await this.identities.teamIdsOf(caller.userId, tenantId);
    const active = new Set(
      (await this.tenancy.activeBranches(assigned)).map((branch) => branch.id),
    );
    return assigned.filter((id) => active.has(id));
  }

  /** Keeps the session's branch while still allowed, otherwise falls back to the first candidate. */
  async resolve(
    caller: BranchCaller,
    tenantId: string,
    sessionId: string,
    activeBranchId: string | null | undefined,
  ): Promise<string | undefined> {
    const candidates = await this.candidates(caller, tenantId);
    if (activeBranchId && candidates.includes(activeBranchId)) {
      return activeBranchId;
    }
    const [first] = candidates;
    await this.identities.updateSession(sessionId, { activeTeamId: first ?? null });
    return first;
  }
}
