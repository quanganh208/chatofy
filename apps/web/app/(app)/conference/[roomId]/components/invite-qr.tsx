'use client';

/**
 * A QR code that opens the meeting, beside "Copy invite link".
 *
 * Wordly, Maestra and JotMe all let someone in the same room join from a phone by scanning a
 * code. Typing a long meeting address on a phone is the slow part of joining; a camera is
 * not. It is a popover rather than a page: the call stays on screen behind it.
 *
 * The symbol is drawn in black on white with a four-module quiet zone, whatever the theme:
 * scanners read dark-on-light, and a dark-theme inversion would not scan on many phones. It
 * is the one place in the app a pure white square is deliberate, and it carries no colour
 * from the palette.
 */

import { useMemo } from 'react';
import { QrCode } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@chatofy/ui/react';
import { qrMatrix } from '@/lib/qr-matrix';
import { useTranslate } from '@/i18n/provider';

const QUIET_ZONE = 4;

function QrCodeSvg({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => qrMatrix(text), [text]);
  const side = size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${side} ${side}`}
      className="size-48 rounded-md"
      shapeRendering="crispEdges"
    >
      <rect width={side} height={side} fill="white" />
      <path transform={`translate(${QUIET_ZONE} ${QUIET_ZONE})`} d={path} fill="black" />
    </svg>
  );
}

/**
 * `url` is a function so the address is read when the popover opens, in the browser,
 * and never during the server render of this client page.
 */
export function InviteQr({ url }: { url: () => string }) {
  const t = useTranslate();
  const label = t('web.conference.showQr');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label}>
          <QrCode className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" aria-label={label} className="w-64">
        <InviteQrBody url={url()} />
      </PopoverContent>
    </Popover>
  );
}

function InviteQrBody({ url }: { url: string }) {
  const t = useTranslate();
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-body text-center font-medium">{t('web.conference.qrTitle')}</p>
      <QrCodeSvg text={url} label={t('web.conference.qrLabel')} />
      <p className="text-hint text-muted-foreground text-center">{t('web.conference.qrHint')}</p>
      <p className="text-hint text-muted-foreground w-full text-center break-all select-all">
        {url}
      </p>
    </div>
  );
}
