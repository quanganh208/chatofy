'use client';

import type { TranslationDirection } from '@chatofy/types';
import { SegmentedControl } from '@/components/ui/segmented-control';

interface DirectionToggleProps {
  value: TranslationDirection;
  disabled?: boolean;
  onChange: (direction: TranslationDirection) => void;
}

const OPTIONS = [
  { value: 'vi_to_en', label: 'VI → EN' },
  { value: 'en_to_vi', label: 'EN → VI' },
] as const satisfies ReadonlyArray<{ value: TranslationDirection; label: string }>;

/** vi→en / en→vi toggle for the translate form. */
export function DirectionToggle({ value, disabled, onChange }: DirectionToggleProps) {
  return (
    <SegmentedControl
      label="Direction"
      value={value}
      options={OPTIONS}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
