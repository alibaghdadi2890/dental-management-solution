import { AUTH_PROBLEM_CODES, type Session } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { changePassword, signIn, signOut } from '@/features/auth/auth-api';
import { sessionQueryOptions } from '@/features/auth/session';
import { landingPath } from '@/features/auth/session-guard';
import { SetPasswordForm } from '@/features/auth/set-password-form';
import { SignInForm } from '@/features/auth/sign-in-form';
import { ApiError } from '@/lib/api';

const searchSchema = z.object({ reason: z.enum(['expired', 'suspended']).optional() });

export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation('auth');
  const { reason } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [temporaryPassword, setTemporaryPassword] = useState<string>();
  const [problem, setProblem] = useState<string>();

  // A pending password change keeps the user here until it is done.
  const session = useQuery({ ...sessionQueryOptions(), throwOnError: false });
  const pendingPassword = session.data?.mustChangePassword === true;

  const enter = async (current: Session) => {
    await navigate({ to: landingPath(current) });
  };

  // Already signed in (e.g. the back button): go straight to the app.
  const signedIn = session.data;
  useEffect(() => {
    if (signedIn && !signedIn.mustChangePassword) {
      void navigate({ to: landingPath(signedIn) });
    }
  }, [signedIn, navigate]);

  const afterSignIn = async (password: string) => {
    queryClient.removeQueries({ queryKey: ['session'] });
    try {
      const current = await queryClient.query(sessionQueryOptions());
      if (current.mustChangePassword) {
        setTemporaryPassword(password);
        return;
      }
      await enter(current);
    } catch (error) {
      // Signed in, but the clinic cannot be entered: explain and drop the session.
      await signOut().catch(() => undefined);
      const code = error instanceof ApiError ? error.code : undefined;
      setProblem(
        code === AUTH_PROBLEM_CODES.tenantSuspended
          ? t('notices.suspended')
          : code === AUTH_PROBLEM_CODES.noTenant
            ? t('errors.noTenant')
            : t('errors.generic'),
      );
    }
  };

  const leave = () => {
    void signOut()
      .catch(() => undefined)
      .then(() => {
        queryClient.clear();
        setTemporaryPassword(undefined);
      });
  };

  if (pendingPassword) {
    return (
      <SetPasswordForm
        temporaryPassword={temporaryPassword}
        submit={changePassword}
        onSignOut={leave}
        onDone={async () => {
          queryClient.removeQueries({ queryKey: ['session'] });
          await enter(await queryClient.query(sessionQueryOptions()));
        }}
      />
    );
  }

  const notice =
    problem ??
    (reason === 'expired'
      ? t('notices.expired')
      : reason === 'suspended'
        ? t('notices.suspended')
        : undefined);

  return <SignInForm notice={notice} submit={signIn} onSignedIn={afterSignIn} />;
}
