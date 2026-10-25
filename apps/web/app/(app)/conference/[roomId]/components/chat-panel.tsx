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
 * translates per recipient). Own messages are distinguished by `mySocketId`.
 */

import { useState } from 'react';
import { Button, Input } from '@chatofy/ui/react';
import type { ConferenceChatMessage } from '@/hooks/use-conference';

interface ChatPanelProps {
  messages: ConferenceChatMessage[];
  mySocketId: string | null;
  onSend: (text: string) => void;
  title: string;
  inputPlaceholder: string;
  sendLabel: string;
  emptyLabel: string;
  /** Why the last message was refused, already in the reader's language. */
  refusalLabel?: string;
}

export function ChatPanel({
  messages,
  mySocketId,
  onSend,
  title,
  inputPlaceholder,
  sendLabel,
  emptyLabel,
  refusalLabel,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  }

  return (
    <section aria-label={title} className="flex min-h-0 flex-col gap-1">
      <h2 className="text-label text-textMuted px-2 pt-2 pb-1 font-semibold uppercase tracking-wide">
        {title}
      </h2>

      {/* Message list */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 py-1">
        {messages.length === 0 ? (
          <p className="text-hint text-textMuted py-2">{emptyLabel}</p>
        ) : (
          messages.map((m) => {
            const isOwn = m.socketId === mySocketId;
            return (
              <div key={m.id} className="flex flex-col">
                <span className="text-hint text-textMuted">
                  {isOwn ? `${m.displayName} •` : m.displayName}
                </span>
                <span className="text-body text-text break-words">{m.text}</span>
              </div>
            );
          })
        )}
      </div>

      {/* A refused message is said here, as text: no control, no accent. */}
      {refusalLabel ? (
        <p role="alert" className="text-hint text-destructive px-2">
          {refusalLabel}
        </p>
      ) : null}

      {/* Composer — ghost/outline only, no accent fill */}
      <form
        className="border-border flex items-center gap-1.5 border-t px-2 py-2"
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
