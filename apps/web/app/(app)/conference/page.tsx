'use client';

/**
 * Conference lobby — name yourself, pick your spoken language, preview your
 * camera, then create a room or join one.
 *
 * "Create a room" asks the API for a new room (`POST /conference`) and goes to
 * the id it returns; that id is what the user shares. "Join" goes to an id
 * someone shared. No room id is ever minted here — the conference socket only
 * admits ids the API created. A shared link without a name lands back here with
 * `?room=` prefilled.
 *
 * Design budget: "Create a room" is the one accent-filled control; Join is
 * outline. No cards: the preview is a region on the page ground.
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input, Label, SegmentedControl } from '@chatofy/ui/react';
import { conferenceRoomIdSchema, MAX_CONFERENCE_DISPLAY_NAME_CHARS } from '@chatofy/types/events';
import { createConference } from '@/clients/api-client';
import { useTranslate } from '@/i18n/provider';
import { ACTIVE_CALL_KEY } from './[roomId]/utils/room-route';

type SourceLanguage = 'vi' | 'en';

function roomPath(roomId: string, name: string, lang: SourceLanguage): Route {
  const params = new URLSearchParams({ name, lang });
  // `as Route`: typedRoutes cannot validate a path built at runtime (same
  // pattern as history-screen.tsx).
  return `/conference/${encodeURIComponent(roomId)}?${params.toString()}` as Route;
}

function ConferenceLobby() {
  const t = useTranslate();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sharedRoom = searchParams.get('room') ?? '';

  // Back to the room if the user navigated away without explicitly leaving —
  // unless they arrived with a different room to join.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ACTIVE_CALL_KEY);
      if (!raw) return;
      const active = JSON.parse(raw) as { roomId?: unknown; name?: unknown; lang?: unknown };
      if (typeof active.roomId !== 'string' || typeof active.name !== 'string' || !active.name) {
        sessionStorage.removeItem(ACTIVE_CALL_KEY);
        return;
      }
      if (sharedRoom && sharedRoom !== active.roomId) return;
      router.replace(roomPath(active.roomId, active.name, active.lang === 'en' ? 'en' : 'vi'));
    } catch {
      sessionStorage.removeItem(ACTIVE_CALL_KEY);
    }
  }, [router, sharedRoom]);

  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState(sharedRoom);
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>(
    searchParams.get('lang') === 'en' ? 'en' : 'vi',
  );
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const previewRef = useRef<HTMLVideoElement>(null);

  // Local camera preview — stopped on unmount so it does not outlive the lobby.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ audio: false, video: true })
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

  /** The trimmed name, or null after saying why it cannot be used. */
  function validName(): string | null {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('web.conference.nameRequired'));
      return null;
    }
    return trimmed;
  }

  async function create() {
    const trimmed = validName();
    if (!trimmed) return;
    setError(null);
    setCreating(true);
    try {
      const room = await createConference();
      router.push(roomPath(room.id, trimmed, sourceLanguage));
    } catch {
      setError(t('web.conference.createFailed'));
      setCreating(false);
    }
  }

  function joinShared() {
    const trimmed = validName();
    if (!trimmed) return;
    const target = roomId.trim();
    if (!target) {
      setError(t('web.conference.roomRequired'));
      return;
    }
    // Only an id the API minted can name a room; anything else is answered now.
    if (!conferenceRoomIdSchema.safeParse(target).success) {
      setError(t('web.conference.roomNotFound'));
      return;
    }
    setError(null);
    router.push(roomPath(target, trimmed, sourceLanguage));
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
          maxLength={MAX_CONFERENCE_DISPLAY_NAME_CHARS}
          autoFocus={Boolean(sharedRoom)}
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

      {error && (
        <p role="alert" className="text-destructive text-hint">
          {error}
        </p>
      )}

      <Button onClick={() => void create()} disabled={creating}>
        {creating ? t('web.conference.creating') : t('web.conference.create')}
      </Button>

      <div className="flex flex-col gap-2">
        <Label htmlFor="conf-room">{t('web.conference.roomId')}</Label>
        <div className="flex gap-2">
          <Input
            id="conf-room"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder={t('web.conference.roomIdPlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
          <Button variant="outline" onClick={joinShared} disabled={creating}>
            {t('web.conference.join')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * `useSearchParams` in a prerendered route needs a Suspense boundary, or the
 * build bails the whole page out of static rendering.
 */
export default function ConferenceLobbyPage() {
  return (
    <Suspense>
      <ConferenceLobby />
    </Suspense>
  );
}
