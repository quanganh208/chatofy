'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils.js';
import { Button } from './button.js';

/**
 * A text field with something beside the text: an icon before it, a control after it.
 *
 * shadcn's `input-group`, re-skinned. The upstream file paints its edge with a
 * border; here the GROUP carries everything `Input` draws on its own — the `card`
 * fill, the `shadow-field` recess, the `--border` hairline as an inset ring, the
 * primary-ink edge on hover, the product-wide focus ring and the red escalation on
 * `aria-invalid` — and the control inside it draws none of it. One box, one edge,
 * one ring, whichever part of it has focus.
 *
 * Deviations from upstream, listed so the next `add input-group --diff` is readable:
 *
 * - `InputGroupInput` is a bare `<input>` rather than a wrapped `Input`. Wrapping it
 *   means cancelling a dozen of `Input`'s states through class merging (rings, inset
 *   rings, the recess, the invalid escalation), and a cancellation the merger does not
 *   recognise leaves a second edge drawn inside the first. Owning the few classes the
 *   inner control needs is the smaller surface.
 * - The focus ring is keyed to `:focus-visible` on the control only, as upstream does,
 *   so clicking the reveal button does not ring the whole field.
 * - No `InputGroupTextarea`: nothing renders a multi-line group, and its re-skin would
 *   be untested code.
 * - Heights follow `Input` (40px, 44px under a touch pointer), not upstream's 36px.
 */
function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        'group/input-group relative flex h-10 w-full min-w-0 items-center rounded-md pointer-coarse:h-11',
        'bg-card shadow-field inset-ring-1 inset-ring-border',
        'transition-[color,background-color,box-shadow] duration-fast ease-standard',
        'motion-reduce:transition-none',
        'hover:inset-ring-primary/40',
        'has-[[data-slot=input-group-control]:focus-visible]:ring-[3px]',
        'has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50',
        'has-[[data-slot=input-group-control]:focus-visible]:inset-ring-ring',
        'has-[[data-slot=input-group-control][aria-invalid=true]]:ring-[1px]',
        'has-[[data-slot=input-group-control][aria-invalid=true]]:ring-destructive',
        'has-[[data-slot=input-group-control][aria-invalid=true]]:inset-ring-destructive',
        'has-[[data-slot=input-group-control][aria-invalid=true]:focus-visible]:ring-[3px]',
        'has-[[data-slot=input-group-control][aria-invalid=true]:focus-visible]:ring-destructive/50',
        // Both conditions at once, spelled out as `Input` does, so which edge colour
        // wins is not decided by the generated stylesheet's order.
        'has-[[data-slot=input-group-control][aria-invalid=true]:focus-visible]:inset-ring-destructive',
        'has-[[data-slot=input-group-control][aria-invalid=true]]:hover:inset-ring-destructive',
        'has-[[data-slot=input-group-control]:read-only]:hover:inset-ring-border',
        'has-[[data-slot=input-group-control]:disabled]:pointer-events-none',
        'has-[[data-slot=input-group-control]:disabled]:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  cn(
    'flex h-auto cursor-text items-center justify-center gap-2 text-hint text-muted-foreground select-none',
    "[&>svg:not([class*='size-'])]:size-4",
  ),
  {
    variants: {
      align: {
        'inline-start': 'order-first pl-3 has-[>button]:pl-1',
        'inline-end': 'order-last pr-3 has-[>button]:pr-1',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
);

function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) {
          return;
        }
        e.currentTarget.parentElement?.querySelector('input')?.focus();
      }}
      {...props}
    />
  );
}

const inputGroupButtonVariants = cva('shadow-none', {
  variants: {
    size: {
      // 32px drawn inside a 40px field; under a touch pointer the field is 44px and
      // the button fills its height so the target is the field's own.
      'icon-sm': 'size-8 p-0 has-[>svg]:p-0 pointer-coarse:size-11',
    },
  },
  defaultVariants: {
    size: 'icon-sm',
  },
});

function InputGroupButton({
  className,
  type = 'button',
  variant = 'ghost',
  size = 'icon-sm',
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'size'> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type={type}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'flex items-center gap-2 text-hint text-muted-foreground',
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupInput({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      data-slot="input-group-control"
      className={cn(
        'h-full w-full min-w-0 flex-1 rounded-md bg-transparent px-3 py-2 outline-none',
        'text-body text-foreground pointer-coarse:text-base',
        'placeholder:text-muted-foreground',
        'group-has-[>[data-align=inline-start]]/input-group:pl-2',
        'group-has-[>[data-align=inline-end]]/input-group:pr-1',
        'disabled:cursor-not-allowed read-only:cursor-default',
        // Autofill paints its own background on the control, which now sits inside the
        // group's edge between the icon and the reveal button. Cover it with the
        // group's fill so a saved login does not tint only the middle of the field.
        'autofill:shadow-[inset_0_0_0_1000px_var(--card)] autofill:[-webkit-text-fill-color:var(--foreground)]',
        className,
      )}
      {...props}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput };
