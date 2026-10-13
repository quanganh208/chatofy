'use client';

/**
 * Conference lobby — name yourself, pick your spoken language, choose or accept
 * a room id, and preview your camera before entering.
 *
 * Phase 1 (Issue #207 follow-up): this is the production entry point that
 * replaces the dev-only `/conference-poc` page. The in-call UI lives at
 * `/conference/[roomId]`; this page only gathers the inputs the room needs and
 * routes there. No signaling happens here — the camera preview is a local
 * `getUserMedia` that is stopped on unmount so it never leaks into the room's
 * own capture. "Create" and "join" are the same action: a prefilled random id
 * you can share, or replace with one someone shared with you.
 */

import { useEffect, useRef, useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { Button, Input, Label, SegmentedControl } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

type SourceLanguage = 'vi' | 'en';

/** A short, human-typeable room id for the "create" flow. */
function generateRoomId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export default function ConferenceLobbyPage() {
  const t = useTranslate();
  const router = useRouter();

  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState(generateRoomId);
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>('vi');
  const [error, setError] = useState<string | null>(null);

  const previewRef = useRef<HTMLVideoElement>(null);

  // Local camera preview — stopped on unmount so it does not outlive the lobby.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ audio: false, video: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        if (previewRef.current) previewRef.current.srcObject = s;
      })
      .catch(() => {
        /* no preview if the camera is unavailable; joining still works */
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function start() {
    if (!name.trim()) {
      setError(t('web.conference.nameRequired'));
      return;
    }
    const targetRoom = roomId.trim();
    if (!targetRoom) {
      setError(t('web.conference.roomRequired'));
      return;
    }
    const params = new URLSearchParams({ name: name.trim(), lang: sourceLanguage });
    // `as Route`: typedRoutes cannot validate a path built at runtime (same
    // pattern as history-screen.tsx).
    router.push(`/conference/${encodeURIComponent(targetRoom)}?${params.toString()}` as Route);
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-8">
      <h1 className="text-heading font-semibold">{t('web.conference.lobbyTitle')}</h1>

      {/* Camera preview */}
      <div className="bg-muted aspect-video w-full overflow-hidden rounded-xl">
        <video ref={previewRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="conf-name">{t('web.conference.yourName')}</Label>
        <Input
          id="conf-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('web.conference.yourNamePlaceholder')}
          autoComplete="name"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="conf-room">{t('web.conference.roomId')}</Label>
        <Input
          id="conf-room"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder={t('web.conference.roomIdPlaceholder')}
        />
      </div>

      <SegmentedControl<SourceLanguage>
        label={t('web.conference.sourceLanguage')}
        value={sourceLanguage}
        onChange={setSourceLanguage}
        options={[
          { value: 'vi', label: t('web.conference.sourceLanguageVi') },
          { value: 'en', label: t('web.conference.sourceLanguageEn') },
        ]}
      />

      {error && <p className="text-destructive text-hint">{error}</p>}

      <Button onClick={start}>{t('web.conference.start')}</Button>
    </div>
  );
}
