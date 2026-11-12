'use client';

/**
 * Conference landing — start a meeting or join one.
 *
 * "New meeting" asks the API for a room (`POST /conference`) and goes to its
 * URL; "Join with a code" opens a dialog that takes a code or a pasted invite
 * link. Neither asks for a name or a language: those are chosen on the room's
 * pre-join screen, prefilled from the account, so the URL anyone shares is the
 * room and nothing else. No room id is ever minted here — the conference socket
 * only admits ids the API created.
 *
 * The actions stay in the content rather than the topbar: they are the whole
 * page, and moving them up would leave a heading over empty ground.
 *
 * Design budget: "New meeting" is the one accent-filled control; "Join with a
 * code" is outline. While the join dialog is open its Join is the accent, so New
 * meeting steps down to outline behind the scrim. No cards: a heading, a line and
 * two buttons on the page ground.
 */

import { Suspense, useEffect, useState } from 'react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Video } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import { createConference } from '@/clients/api-client';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';
import { ACTIVE_CALL_KEY } from './[roomId]/utils/room-route';
import { parseRoomInput } from './utils/parse-room-input';
import { JoinByCodeDialog } from './components/join-by-code-dialog';

/** One toast for a failed create, so pressing Retry repeatedly never stacks them. */
const CREATE_FAILED_TOAST = 'conference-create-failed';

function roomPath(roomId: string): Route {
  // `as Route`: typedRoutes cannot validate a path built at runtime (same
  // pattern as history/use-history-search.ts).
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

  const [creating, setCreating] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  async function create() {
    notify.dismiss(CREATE_FAILED_TOAST);
    setCreating(true);
    try {
      const room = await createConference();
      router.push(roomPath(room.id));
    } catch {
      setCreating(false);
      notify.error(t('web.conference.createFailedToast'), {
        id: CREATE_FAILED_TOAST,
        retry: () => void create(),
      });
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-8 lg:pt-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-title font-display font-light tracking-tight text-balance">
          {t('common.conference.lobbyTitle')}
        </h2>
        <p className="text-body text-muted-foreground">{t('web.conference.landingLead')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={joinOpen ? 'outline' : 'default'}
          onClick={() => void create()}
          disabled={creating}
          data-new-meeting
        >
          <Video aria-hidden />
          {creating ? t('common.conference.creating') : t('web.conference.newMeeting')}
        </Button>
        <JoinByCodeDialog
          open={joinOpen}
          onOpenChange={setJoinOpen}
          disabled={creating}
          onJoin={(roomId) => router.push(roomPath(roomId))}
        />
      </div>

      {accountName && (
        <p className="text-hint text-muted-foreground border-hairline border-t pt-4">
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
