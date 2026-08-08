'use client';

import { Radio, Waves } from 'lucide-react';
import type { TranslateMode } from '@chatofy/types';
import { Button } from '@/components/ui/button';

// The mode union itself lives in `@chatofy/types`: the extension offers the same
// choice, and two spellings of one product concept is how they drift.

interface ModeToggleProps {
  value: TranslateMode;
  /** Held while a session is running — switching would drop it mid-sentence. */
  disabled?: boolean;
  onChange: (mode: TranslateMode) => void;
}

/** Cascade / live toggle for the translate page. */
export function ModeToggle({ value, disabled, onChange }: ModeToggleProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm">Mode</span>
      <div className="flex gap-2">
        <Button
          variant={value === 'cascade' ? 'default' : 'outline'}
          onClick={() => onChange('cascade')}
          disabled={disabled}
        >
          <Waves className="size-4" aria-hidden />
          Cascade
        </Button>
        <Button
          variant={value === 'live' ? 'default' : 'outline'}
          onClick={() => onChange('live')}
          disabled={disabled}
        >
          <Radio className="size-4" aria-hidden />
          Live
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {value === 'cascade'
          ? 'Speech recognition, then translation, then speech — a turn at a time.'
          : 'One model, end to end. It starts speaking before you finish. Use headphones.'}
      </p>
    </div>
  );
}
