/**
 * How loud the microphone is right now — the pre-join answer to "can they hear me".
 *
 * A readout, not a control. Filled with `speaking`, the state colour for sound
 * being heard, so a moving bar reads as "it hears you" rather than as an action.
 */
export function MicLevelMeter({ level, label }: { level: number; label: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, level)) * 100);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
    >
      <div
        className="bg-speaking h-full transition-[width] duration-75 motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
