'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Switch,
} from '@chatofy/ui/react';
import type { GlossaryTermRecord } from '@chatofy/types';
import { CardEyebrow } from '@/components/dashboard/card-eyebrow';
import { useGlossary, type WriteResult } from '@/hooks/use-glossary';
import { useTranslate } from '@/i18n/provider';

/**
 * The glossary manager: add term pairs, edit or delete them, mark a name to keep
 * verbatim. The list is owner-scoped server-side; this component names no user.
 *
 * Editing is inline rather than in a dialog — the UI package ships no dialog, and
 * one row at a time is enough for a list this size. Delete is immediate for the
 * same reason; a pair is cheap to re-add, and a confirm step over a modal that
 * does not exist would be more machinery than the action warrants.
 */
export function GlossaryCard() {
  const t = useTranslate();
  const { terms, loading, loadError, add, update, remove, reload } = useGlossary();

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <CardEyebrow>{t('web.glossary.title')}</CardEyebrow>
          <p className="text-hint text-muted-foreground max-w-prose">{t('web.glossary.hint')}</p>
        </div>

        <AddTermForm onAdd={add} />

        {loadError ? (
          <Alert variant="live">
            <AlertDescription className="flex items-center justify-between gap-4">
              {t('web.glossary.loadError')}
              <Button variant="outline" size="sm" onClick={() => void reload()}>
                {t('web.glossary.add')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {!loading && !loadError && terms.length === 0 ? (
          <p className="text-hint text-muted-foreground">{t('web.glossary.empty')}</p>
        ) : null}

        {terms.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {terms.map((term) => (
              <TermRow key={term.id} term={term} onSave={update} onDelete={remove} />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The add form — two spellings and the keep-verbatim toggle. */
function AddTermForm({
  onAdd,
}: {
  onAdd: (body: { vi: string; en: string; keepVerbatim: boolean }) => Promise<WriteResult>;
}) {
  const t = useTranslate();
  const [vi, setVi] = useState('');
  const [en, setEn] = useState('');
  const [keepVerbatim, setKeepVerbatim] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<'duplicate' | 'error' | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!vi.trim() || !en.trim() || adding) return;
    setAdding(true);
    setError(null);
    const result = await onAdd({ vi: vi.trim(), en: en.trim(), keepVerbatim });
    setAdding(false);
    if (result === 'ok') {
      setVi('');
      setEn('');
      setKeepVerbatim(false);
    } else {
      setError(result);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="glossary-vi">{t('web.glossary.viLabel')}</Label>
          <Input
            id="glossary-vi"
            value={vi}
            onChange={(e) => setVi(e.target.value)}
            placeholder={t('web.glossary.viPlaceholder')}
            maxLength={64}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="glossary-en">{t('web.glossary.enLabel')}</Label>
          <Input
            id="glossary-en"
            value={en}
            onChange={(e) => setEn(e.target.value)}
            placeholder={t('web.glossary.enPlaceholder')}
            maxLength={64}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch id="glossary-keep" checked={keepVerbatim} onCheckedChange={setKeepVerbatim} />
          <Label htmlFor="glossary-keep" className="text-hint text-muted-foreground">
            {t('web.glossary.keepVerbatim')}
          </Label>
        </div>
        <Button type="submit" disabled={adding || !vi.trim() || !en.trim()}>
          {adding ? t('web.glossary.adding') : t('web.glossary.add')}
        </Button>
      </div>
      {error ? (
        <Alert variant="live">
          <AlertDescription>
            {error === 'duplicate' ? t('web.glossary.duplicateError') : t('web.glossary.saveError')}
          </AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}

/** One term: read-only until Edit turns it into the same two fields plus the toggle. */
function TermRow({
  term,
  onSave,
  onDelete,
}: {
  term: GlossaryTermRecord;
  onSave: (
    id: string,
    patch: { vi: string; en: string; keepVerbatim: boolean },
  ) => Promise<WriteResult>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const t = useTranslate();
  const [editing, setEditing] = useState(false);
  const [vi, setVi] = useState(term.vi);
  const [en, setEn] = useState(term.en);
  const [keepVerbatim, setKeepVerbatim] = useState(term.keepVerbatim);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'duplicate' | 'error' | null>(null);

  const beginEdit = () => {
    setVi(term.vi);
    setEn(term.en);
    setKeepVerbatim(term.keepVerbatim);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (!vi.trim() || !en.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await onSave(term.id, { vi: vi.trim(), en: en.trim(), keepVerbatim });
    setBusy(false);
    if (result === 'ok') setEditing(false);
    else setError(result);
  };

  const del = async () => {
    setBusy(true);
    await onDelete(term.id);
    // On success the row unmounts; on failure it stays and the button re-enables.
    setBusy(false);
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-3 py-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input value={vi} onChange={(e) => setVi(e.target.value)} maxLength={64} />
          <Input value={en} onChange={(e) => setEn(e.target.value)} maxLength={64} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id={`keep-${term.id}`}
              checked={keepVerbatim}
              onCheckedChange={setKeepVerbatim}
            />
            <Label htmlFor={`keep-${term.id}`} className="text-hint text-muted-foreground">
              {t('web.glossary.keepVerbatim')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              {t('web.glossary.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={busy || !vi.trim() || !en.trim()}
            >
              {t('web.glossary.save')}
            </Button>
          </div>
        </div>
        {error ? (
          <Alert variant="live">
            <AlertDescription>
              {error === 'duplicate'
                ? t('web.glossary.duplicateError')
                : t('web.glossary.saveError')}
            </AlertDescription>
          </Alert>
        ) : null}
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-body text-prose break-words">{term.vi}</span>
        <span className="text-muted-foreground">=</span>
        <span className="text-body text-prose break-words">{term.en}</span>
        {term.keepVerbatim ? (
          <Badge variant="secondary">{t('web.glossary.verbatimBadge')}</Badge>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={beginEdit} disabled={busy}>
          {t('web.glossary.edit')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void del()} disabled={busy}>
          {t('web.glossary.delete')}
        </Button>
      </div>
    </li>
  );
}
