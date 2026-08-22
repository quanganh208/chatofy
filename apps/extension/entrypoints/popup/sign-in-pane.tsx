import { useState } from 'react';
import { Alert, AlertDescription, Button, Label } from '@chatofy/ui/react';
import type { usePopup } from './use-popup';

type Popup = ReturnType<typeof usePopup>;

/**
 * Sign in, so a capture has an identity to open its socket with.
 *
 * The popup is the extension's only page, and `/ws/translate` refuses an
 * unauthenticated upgrade — so without this there is nowhere for a token to come
 * from and the extension cannot reach an enforcing API at all.
 *
 * It replaces the settings and the Start button rather than sitting above them:
 * every one of those is a choice about a capture that cannot begin yet, and
 * offering Start here would produce a failure the user can do nothing about
 * except come back to this form.
 */
export function SignInPane({ popup, hidden }: { popup: Popup; hidden: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const field =
    'border-hairline bg-background text-body w-full rounded-md border px-3 py-2 outline-none focus-visible:ring-2';

  return (
    <main
      id="sign-in"
      hidden={hidden}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-4"
    >
      <div className="flex flex-col gap-1">
        <strong className="text-body font-semibold tracking-tight">Sign in</strong>
        <p className="text-muted-foreground text-hint">
          Chatofy translates through your account. Captures cannot start until you sign in.
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          popup.actions.submitSignIn(email, password);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sign-in-email">Email</Label>
          <input
            id="sign-in-email"
            type="email"
            required
            autoComplete="username"
            className={field}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sign-in-password">Password</Label>
          <input
            id="sign-in-password"
            type="password"
            required
            autoComplete="current-password"
            className={field}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {popup.signInError ? (
          // The API's own wording. It answers a wrong password and an unknown
          // email identically on purpose, and rephrasing here risks saying more
          // than it chose to.
          <Alert id="sign-in-error" variant="destructive">
            <AlertDescription>{popup.signInError}</AlertDescription>
          </Alert>
        ) : null}

        <Button id="sign-in-submit" type="submit" className="w-full" disabled={popup.signingIn}>
          {popup.signingIn ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
