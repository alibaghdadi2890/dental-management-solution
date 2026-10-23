import { Injectable } from '@nestjs/common';

/** The caller's visits, or `'all'` (ADR-0055). */
export type VisitIdsInScope = () => Promise<readonly string[] | 'all'>;

/**
 * The port through which the audit feed learns which visits the caller may see (ADR-0055).
 * `audit` cannot read `clinical`'s tables or depend on it (`clinical` depends on `audit`), so
 * `clinical` registers the answer when its module starts. Without a registration a caller whose
 * scope is not every visit sees no visit's rows: closed, never open.
 */
@Injectable()
export class AuditVisitScope {
  private provider: VisitIdsInScope | undefined;

  register(provider: VisitIdsInScope): void {
    this.provider = provider;
  }

  visitIdsInScope(): Promise<readonly string[] | 'all'> {
    return this.provider ? this.provider() : Promise.resolve([]);
  }
}
