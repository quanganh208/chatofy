'use client';

import type { TranslationDirection } from '@chatofy/types';
import { Button } from '@/components/ui/button';

interface DirectionToggleProps {
  value: TranslationDirection;
  disabled?: boolean;
  onChange: (direction: TranslationDirection) => void;
}

/** vi→en / en→vi toggle for the translate form. */
export function DirectionToggle({ value, disabled, onChange }: DirectionToggleProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm">Direction</span>
      <div className="flex gap-2">
        <Button
          variant={value === 'vi_to_en' ? 'default' : 'outline'}
          onClick={() => onChange('vi_to_en')}
          disabled={disabled}
        >
          VI → EN
        </Button>
        <Button
          variant={value === 'en_to_vi' ? 'default' : 'outline'}
          onClick={() => onChange('en_to_vi')}
          disabled={disabled}
        >
          EN → VI
        </Button>
      </div>
    </div>
  );
}
