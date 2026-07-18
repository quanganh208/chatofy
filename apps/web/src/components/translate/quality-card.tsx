'use client';

import { Slider } from '@/components/ui/slider';

function qualityLabel(q: number): string {
  if (q < 0.34) return 'Speed';
  if (q < 0.67) return 'Balanced';
  return 'Quality';
}

interface QualityCardProps {
  value: number;
  disabled?: boolean;
  onChange: (quality: number) => void;
}

/** Speed↔quality slider (0 = fastest models, 1 = highest quality). */
export function QualityCard({ value, disabled, onChange }: QualityCardProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span>Speed</span>
        <span className="font-medium">
          {qualityLabel(value)} ({value.toFixed(2)})
        </span>
        <span>Quality</span>
      </div>
      <Slider
        min={0}
        max={1}
        step={0.01}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? 0.5)}
        disabled={disabled}
      />
    </div>
  );
}
