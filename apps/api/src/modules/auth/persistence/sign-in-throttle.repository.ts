import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { ThrottleState } from '../domain/sign-in-throttle';
import { IdentityDb } from './identity-db';
import { authSignInThrottle } from './schema';

@Injectable()
export class SignInThrottleRepository {
  constructor(private readonly db: IdentityDb) {}

  async find(email: string): Promise<ThrottleState | null> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(authSignInThrottle).where(eq(authSignInThrottle.email, email)),
    );
    return row ?? null;
  }

  /** Read-modify-write under a row lock, so parallel failures cannot under-count. */
  async update(
    email: string,
    next: (state: ThrottleState | null) => ThrottleState,
  ): Promise<ThrottleState> {
    return this.db.run(async (tx) => {
      await tx.insert(authSignInThrottle).values({ email }).onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(authSignInThrottle)
        .where(eq(authSignInThrottle.email, email))
        .for('update');
      const state = next(row && row.failedAttempts > 0 ? row : null);
      await tx.update(authSignInThrottle).set(state).where(eq(authSignInThrottle.email, email));
      return state;
    });
  }

  async clear(email: string): Promise<void> {
    await this.db.run((tx) =>
      tx.delete(authSignInThrottle).where(eq(authSignInThrottle.email, email)),
    );
  }
}
