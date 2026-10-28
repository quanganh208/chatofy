'use client';

import { createPortal } from 'react-dom';
import type { ComponentProps } from 'react';
import { CaptionStage } from '@/components/translate/caption-stage';

/**
 * The stage, rendered into the caption window's document.
 *
 * A portal rather than a second React root, so the window is one more view of
 * the same state rather than a copy that has to be kept in step: every new turn
 * the page renders, the window renders in the same commit. See
 * `use-caption-window.ts` for why events and context survive the crossing.
 */
export function CaptionWindowPortal({
  container,
  ...stage
}: { container: HTMLElement } & ComponentProps<typeof CaptionStage>) {
  return createPortal(<CaptionStage {...stage} />, container);
}
