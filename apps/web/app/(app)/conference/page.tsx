'use client';

/**
 * Conference landing — start a meeting or join one, the way Meet opens.
 *
 * "New meeting" asks the API for a room (`POST /conference`) and goes to its
 * URL; "Join" takes a code or a pasted invite link. Neither asks for a name or a
 * language: those are chosen on the room's pre-join screen, prefilled from the
 * account, so the URL anyone shares is the room and nothing else. No room id is
 * ever minted here — the conference socket only admits ids the API created.
 *
 * Design budget: "New meeting" is the one accent-filled control; Join is
 * outline beside the code field. No cards; the dawn band is decoration.
 */

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Video } from 'lucide-react';
import { Button, Input, Label } from '@chatofy/ui/react';
import { createConference } from '@/clients/api-client';
import { useTranslate } from '@/i18n/provider';
import { ACTIVE_CALL_KEY } from './[roomId]/utils/room-route';
import { parseRoomInput } from './utils/parse-room-input';
import { DAWN_GRADIENT } from './components/dawn-glow';

function roomPath(roomId: string): Route {
  // `as Route`: typedRoutes cannot validate a path built at runtime (same
  // pattern as history-screen.tsx).
  return `/conference/${encodeURIComponent(roomId)}` as Route;
}

function ConferenceLanding() {
  const t = useTranslate();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const accountName = session?.user?.name?.trim() || null;
  const sharedRoom = searchParams.get('room') ?? '';

  // A link from the old lobby named the room as `?room=`; it now goes straight
  // to the room. Otherwise, back to a call the user navigated away from without
  // leaving — which lands on its pre-join screen, one "Join now" away.
  useEffect(() => {
    const shared = parseRoomInput(sharedRoom);
    if (shared) {
      router.replace(roomPath(shared));
      return;
    }
    try {
      const raw = sessionStorage.getItem(ACTIVE_CALL_KEY);
      if (!raw) return;
      const active = JSON.parse(raw) as { roomId?: unknown };
      if (typeof active.roomId !== 'string' || !active.roomId) {
        sessionStorage.removeItem(ACTIVE_CALL_KEY);
        return;
      }
      router.replace(roomPath(active.roomId));
    } catch {
      sessionStorage.removeItem(ACTIVE_CALL_KEY);
    }
  }, [router, sharedRoom]);

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function create() {
    setError(null);
    setCreating(true);
    try {
      const room = await createConference();
      router.push(roomPath(room.id));
    } catch {
      setError(t('common.conference.createFailed'));
      setCreating(false);
    }
  }

  function join(event: FormEvent) {
    event.preventDefault();
    const roomId = parseRoomInput(code);
    if (!roomId) {
      setError(t('common.conference.roomNotFound'));
      return;
    }
    setError(null);
    router.push(roomPath(roomId));
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        {/* The brand cue the pre-join screen carries as a glow: here a band,
            because every part of this column is text and dawn never sits behind it. */}
        <div
          aria-hidden
          className="mb-2 h-1.5 w-24 rounded-full"
          style={{ backgroundImage: DAWN_GRADIENT }}
        />
        <h2 className="text-heading font-semibold">{t('common.conference.lobbyTitle')}</h2>
        <p className="text-body text-textMuted">{t('web.conference.landingLead')}</p>
      </div>

      <Button onClick={() => void create()} disabled={creating}>
        <Video aria-hidden />
        {creating ? t('common.conference.creating') : t('web.conference.newMeeting')}
      </Button>

      <form className="flex flex-col gap-2" onSubmit={join}>
        <Label htmlFor="conf-room">{t('web.conference.codeOrLink')}</Label>
        <div className="flex gap-2">
          <Input
            id="conf-room"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('web.conference.codeOrLinkPlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="outline" disabled={creating || !code.trim()}>
            {t('web.conference.joinAction')}
          </Button>
        </div>
      </form>

      {error && (
        <p role="alert" className="text-destructive text-hint">
          {error}
        </p>
      )}

      {accountName && (
        <p className="text-hint text-textMuted">
          {t('web.conference.joiningAs', { name: accountName })}
        </p>
      )}
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
      <ConferenceLanding />
    </Suspense>
  );
}
