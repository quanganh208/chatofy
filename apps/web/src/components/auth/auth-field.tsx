'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, EyeIcon, EyeOffIcon, type LucideIcon } from 'lucide-react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Label,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * The field computes its own `aria-describedby` and `aria-invalid` and holds its own
 * ref, so a caller cannot pass them — they would be dropped silently.
 */
interface AuthFieldProps extends Omit<
  React.ComponentProps<typeof InputGroupInput>,
  'aria-describedby' | 'aria-invalid' | 'ref'
> {
  id: string;
  label: string;
  /**
   * The mark before the text: what kind of thing this field takes. Decorative, and
   * optional — the Settings dialog's password fields borrow this component and draw none.
   */
  icon?: LucideIcon;
  /**
   * Draws the show/hide button on a password field. Opt-in, so the auth screens get
   * it and the Settings dialog's fields, which share this component, are unchanged.
   */
  revealable?: boolean;
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
  /**
   * A requirement the value must meet, shown under the field and ticked once the
   * typed value reaches `minLength`. Only for a NEW password: on sign in, a rule
   * under the field would tell someone who already has a password how long it is.
   */
  requirement?: string;
}

/**
 * One labelled input, written once for the auth screens.
 *
 * The five forms had the same eleven lines each, and the `aria-invalid` /
 * `aria-describedby` pair inside them is the wiring that makes a failure
 * reachable from a screen reader rather than only visible. Eleven lines copied
 * five times is five places for that pair to be dropped by an edit that was only
 * meant to change a placeholder.
 *
 * The red edge comes from `aria-invalid` alone (`input-group.tsx`), so this is
 * wiring, not styling: an invalid field looks invalid because it IS marked invalid.
 *
 * ## The reveal button keeps the field a password field until someone asks
 *
 * The server renders `type="password"`, and so does every render until the button is
 * pressed — a value typed or autofilled before hydration is never shown, and password
 * managers see the field they expect. Switching `type` keeps the DOM value, so the
 * uncontrolled forms still read what was typed from `FormData`.
 *
 * ## The requirement is counted from the DOM, not held in it
 *
 * The forms are uncontrolled on purpose (`login-form.tsx` records why), so the field
 * listens to `input` events for the length and never writes a value back.
 */
export function AuthField({
  id,
  label,
  icon: Icon,
  revealable = false,
  errorId,
  requirement,
  type,
  minLength,
  onInput,
  ...input
}: AuthFieldProps) {
  const t = useTranslate();
  const [revealed, setRevealed] = useState(false);
  const [requirementMet, setRequirementMet] = useState(false);
  const isPassword = type === 'password' && revealable;
  const requirementId = requirement ? `${id}-requirement` : undefined;
  const describedBy = [errorId, requirementId].filter(Boolean).join(' ') || undefined;
  const control = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = control.current;
    if (!el) return;
    // A password manager can fill the field before hydration, and no `input` event
    // follows — so the requirement is read once from what is already there.
    if (requirement && minLength !== undefined) {
      setRequirementMet(el.value.length >= minLength);
    }
    // Submitting hides a revealed password again: some password managers only offer
    // to save when the field is `type="password"` at submit time, and a rejected
    // sign in should not leave the password on screen.
    const form = el.form;
    if (!form) return;
    const hide = () => setRevealed(false);
    form.addEventListener('submit', hide);
    return () => form.removeEventListener('submit', hide);
  }, [requirement, minLength]);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <InputGroup>
        {Icon ? (
          <InputGroupAddon>
            <Icon aria-hidden />
          </InputGroupAddon>
        ) : null}
        <InputGroupInput
          {...input}
          ref={control}
          id={id}
          type={isPassword && revealed ? 'text' : type}
          minLength={minLength}
          aria-invalid={errorId ? true : undefined}
          aria-describedby={describedBy}
          onInput={(event) => {
            if (requirement && minLength !== undefined) {
              setRequirementMet(event.currentTarget.value.length >= minLength);
            }
            onInput?.(event);
          }}
        />
        {isPassword ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={revealed ? t('web.auth.hidePassword') : t('web.auth.showPassword')}
              aria-pressed={revealed}
              aria-controls={id}
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      {requirement ? (
        <p
          id={requirementId}
          data-met={requirementMet || undefined}
          className={cn(
            'text-hint text-muted-foreground flex items-center gap-1.5',
            'ease-standard duration-fast transition-colors motion-reduce:transition-none',
            'data-[met]:text-foreground',
          )}
        >
          <CheckIcon
            aria-hidden
            className={cn('size-3.5 shrink-0', requirementMet ? 'opacity-100' : 'opacity-40')}
          />
          {requirement}
        </p>
      ) : null}
    </div>
  );
}
