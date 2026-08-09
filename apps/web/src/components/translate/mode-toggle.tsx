'use client';

import { Radio, Waves } from 'lucide-react';
import type { TranslateMode } from '@chatofy/types';
import { SegmentedControl } from '@/components/ui/segmented-control';

// The mode union itself lives in `@chatofy/types`: the extension offers the same
// choice, and two spellings of one product concept is how they drift.

interface ModeToggleProps {
  value: TranslateMode;
  /** Held while a session is running — switching would drop it mid-sentence. */
  disabled?: boolean;
  onChange: (mode: TranslateMode) => void;
}

const OPTIONS = [
  {
    value: 'cascade',
    label: (
      <>
        <Waves className="size-4" aria-hidden />
        Cascade
      </>
    ),
  },
  {
    value: 'live',
    label: (
      <>
        <Radio className="size-4" aria-hidden />
        Live
      </>
    ),
  },
] as const satisfies ReadonlyArray<{ value: TranslateMode; label: React.ReactNode }>;

/** Cascade / live toggle for the translate page. */
export function ModeToggle({ value, disabled, onChange }: ModeToggleProps) {
  return (
    <SegmentedControl
      label="Mode"
      value={value}
      options={OPTIONS}
      disabled={disabled}
      onChange={onChange}
      hint={
        value === 'cascade'
          ? 'Speech recognition, then translation, then speech — a turn at a time.'
          : 'One model, end to end. It starts speaking before you finish. Use headphones.'
      }
    />
  );
}
