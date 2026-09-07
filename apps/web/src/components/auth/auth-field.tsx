'use client';

import { Input, Label } from '@chatofy/ui/react';

interface AuthFieldProps extends React.ComponentProps<typeof Input> {
  id: string;
  label: string;
  /**
   * The id of the message describing a failure, when there is one.
   *
   * Passed rather than derived, because whose failure it is differs per screen:
   * `/login` collapses every outcome into one form-level message and flags BOTH
   * fields with it, deliberately — marking only the email invalid would rebuild
   * the account-existence oracle that message exists to close, in ARIA, where it
   * is just as readable.
   */
  errorId?: string;
}

/**
 * One labelled input, written once for the five auth screens.
 *
 * The five forms had the same eleven lines each, and the `aria-invalid` /
 * `aria-describedby` pair inside them is the wiring that makes a failure
 * reachable from a screen reader rather than only visible. Eleven lines copied
 * five times is five places for that pair to be dropped by an edit that was only
 * meant to change a placeholder.
 *
 * The ring comes from `aria-invalid` alone (`input.tsx`), so this is wiring, not
 * styling: an invalid field looks invalid because it IS marked invalid.
 */
export function AuthField({ id, label, errorId, ...input }: AuthFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        {...input}
      />
    </div>
  );
}
