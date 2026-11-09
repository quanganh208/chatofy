'use client';

/**
 * In-meeting chat panel.
 *
 * A FLAT region — NOT an elevated card (no data-slot="card", no shadow-elev-*).
 * The in-call screen stays within its ≤2 elevated-surface budget and this panel
 * adds zero. Input + send are ghost/outline; the screen's one accent-filled
 * control stays Leave, so this panel spends no accent budget either.
 *
 * Each message arrives already in this client's chosen language (the gateway
 * translates per recipient). Own messages are distinguished by `mySocketId`: they sit on
 * the right in a tinted bubble, others on the left in an outlined one. Consecutive
 * messages from one sender share a single name-and-time line, and the list follows the
 * newest message unless the reader has scrolled up to read.
 */

import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button, Input } from '@chatofy/ui/react';
import type { ConferenceChatMessage } from '@/hooks/use-conference';
import { cn } from '@/lib/utils';

interface ChatPanelProps {
  messages: ConferenceChatMessage[];
  mySocketId: string | null;
  onSend: (text: string) => void;
  title: string;
  inputPlaceholder: string;
  sendLabel: string;
  emptyLabel: string;
  /** What translation means for this panel, shown under the empty sentence. */
  emptyHint?: string;
  /** BCP-47 tag for the time stamps. */
  locale?: string;
  /** Why the last message was refused, already in the reader's language. */
  refusalLabel?: string;
}

/** Within this many px of the bottom counts as "reading the newest". */
const FOLLOW_SLACK = 48;

function clock(sentAt: number, locale: string | undefined): string {
  try {
    return new Date(sentAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function ChatPanel({
  messages,
  mySocketId,
  onSend,
  title,
  inputPlaceholder,
  sendLabel,
  emptyLabel,
  emptyHint,
  locale,
  refusalLabel,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
    // Sending is reading: jump to the bottom whatever the scroll position was.
    following.current = true;
  }

  // Follow the newest message, unless the reader scrolled up — a new line must not
  // yank them away from what they are reading.
  useEffect(() => {
    const el = listRef.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <section aria-label={title} className="flex min-h-0 flex-1 flex-col">
      <h2 className="text-label text-muted-foreground px-3 pt-3 pb-1 font-semibold uppercase tracking-wide">
        {title}
      </h2>

      {/* Message list. `role="log"` is a polite live region, so a screen reader hears a
          message as it arrives without the panel stealing focus. */}
      <div
        ref={listRef}
        role="log"
        aria-label={title}
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK;
        }}
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2"
      >
        {messages.length === 0 ? (
          <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <MessageSquare className="size-6 opacity-60" aria-hidden />
            <p className="text-body">{emptyLabel}</p>
            {emptyHint ? <p className="text-hint">{emptyHint}</p> : null}
          </div>
        ) : (
          messages.map((m, i) => {
            const isOwn = m.socketId === mySocketId;
            const prev = messages[i - 1];
            // A new sender, or a pause of over two minutes, starts a new group.
            const startsGroup =
              !prev || prev.socketId !== m.socketId || m.sentAt - prev.sentAt > 120_000;
            return (
              <div
                key={m.id}
                className={cn(
                  'flex flex-col',
                  isOwn ? 'items-end' : 'items-start',
                  startsGroup && i > 0 && 'mt-2',
                )}
              >
                {startsGroup ? (
                  <span className="text-hint text-muted-foreground px-1 pb-0.5">
                    {isOwn ? '' : `${m.displayName} · `}
                    <time dateTime={new Date(m.sentAt).toISOString()}>
                      {clock(m.sentAt, locale)}
                    </time>
                  </span>
                ) : null}
                <span
                  className={cn(
                    'text-body text-text max-w-[85%] rounded-2xl px-3 py-1.5 break-words',
                    isOwn ? 'bg-muted rounded-br-md' : 'border-border rounded-bl-md border',
                  )}
                >
                  {m.text}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* A refused message is said here, as text: no control, no accent. */}
      {refusalLabel ? (
        <p role="alert" className="text-hint text-destructive px-3 pb-1">
          {refusalLabel}
        </p>
      ) : null}

      {/* Composer — ghost/outline only, no accent fill */}
      <form
        className="border-border flex items-center gap-1.5 border-t px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={inputPlaceholder}
          aria-label={inputPlaceholder}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="outline" size="sm" disabled={!draft.trim()}>
          {sendLabel}
        </Button>
      </form>
    </section>
  );
}
