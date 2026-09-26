import type { SignInRequest } from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { APP_CONFIG } from '../../../platform/config/config.module';
import type { AppConfig } from '../../../platform/config/config.schema';
import type { Clock } from '../../../platform/kernel/clock';
import { AccountLockedError, InvalidCredentialsError } from '../domain/auth-errors';
import { attemptsLeft, lockedUntil, recordFailure } from '../domain/sign-in-throttle';
import { SignInThrottleRepository } from '../persistence/sign-in-throttle.repository';
import { AUTH_BASE_PATH, BETTER_AUTH, type BetterAuth } from './better-auth';
import { readBetterAuthError, toAuthDomainError } from './better-auth-errors';

/**
 * Sign-in and sign-out through better-auth, with the account lockout of D11 around it. Failures
 * are counted per normalised email whether or not an account exists, so the responses never
 * reveal which emails are registered (ADR-0013).
 */
@Injectable()
export class SignInService {
  constructor(
    @Inject(BETTER_AUTH) private readonly auth: BetterAuth,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly throttle: SignInThrottleRepository,
  ) {}

  /** Returns the response headers carrying the session cookies. */
  async signIn(input: SignInRequest, headers: Headers): Promise<Headers> {
    const now = this.clock.now();
    const locked = lockedUntil(await this.throttle.find(input.email), now);
    if (locked) {
      throw new AccountLockedError(locked);
    }

    const response = await this.call('/sign-in/email', headers, input);
    if (response.ok) {
      await this.throttle.clear(input.email);
      return response.headers;
    }

    const error = await readBetterAuthError(response);
    if (error.code !== 'INVALID_EMAIL_OR_PASSWORD') {
      throw toAuthDomainError(response.status, error);
    }
    const state = await this.throttle.update(input.email, (current) => recordFailure(current, now));
    const lockedNow = lockedUntil(state, now);
    if (lockedNow) {
      throw new AccountLockedError(lockedNow);
    }
    throw new InvalidCredentialsError(attemptsLeft(state, now));
  }

  /** Revokes the session and returns headers that clear the cookies. */
  async signOut(headers: Headers): Promise<Headers> {
    const response = await this.call('/sign-out', headers, {});
    if (!response.ok) {
      throw toAuthDomainError(response.status, await readBetterAuthError(response));
    }
    return response.headers;
  }

  private call(path: string, headers: Headers, body: object): Promise<Response> {
    const forwarded = new Headers(headers);
    forwarded.set('content-type', 'application/json');
    return this.auth.handler(
      new Request(new URL(`${AUTH_BASE_PATH}${path}`, this.config.AUTH_BASE_URL), {
        method: 'POST',
        headers: forwarded,
        body: JSON.stringify(body),
      }),
    );
  }
}
