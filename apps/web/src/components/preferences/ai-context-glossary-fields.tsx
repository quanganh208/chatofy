'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Label } from '@chatofy/ui/react';
import { CONTEXT_LIMITS } from '@chatofy/types';
import { sideTooLong, type GlossaryRow } from './ai-context-draft';
import { useTranslate } from '@/i18n/provider';

/**
 * The glossary half of the AI Context editor: a repeating pair of fields.
 *
 * One row is TWO correlated strings, and `ai-context-draft.ts` says why they are
 * named for the two languages rather than for "from" and "to". The list is edited
 * as a whole and handed back as a whole, because that is also how it is stored —
 * the whole context is PUT, so there is no such thing as saving one row.
 *
 * Spends no accent: "Add pair" is `outline` and the row's remove is `ghost`. The
 * editor's Save is the screen's only filled control.
 */
export function AiContextGlossaryFields({
  rows,
  onChange,
}: {
  rows: GlossaryRow[];
  onChange: (rows: GlossaryRow[]) => void;
}) {
  const t = useTranslate();

  return (
    <div className="flex flex-col gap-2">
      <span className="text-body font-medium">{t('web.preferences.aiContext.glossary')}</span>
      <span className="text-muted-foreground text-hint">
        {t('web.preferences.aiContext.glossaryHint')}
      </span>
      <div className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const viTooLong = sideTooLong(row.vi);
          const enTooLong = sideTooLong(row.en);
          return (
            // Indexed because nothing addresses one entry: the whole
            // context is PUT, so the rows have no stable id to key on
            // and the list is only ever rewritten as a unit.
            <div key={index} className="flex flex-col gap-1">
              <div className="flex items-end gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Label
                    htmlFor={`ai-context-glossary-vi-${index}`}
                    className="text-muted-foreground text-hint"
                  >
                    {t('web.preferences.aiContext.glossaryVi')}
                  </Label>
                  <Input
                    id={`ai-context-glossary-vi-${index}`}
                    value={row.vi}
                    maxLength={CONTEXT_LIMITS.MAX_GLOSSARY_TERM_CHARS}
                    aria-invalid={viTooLong}
                    onChange={(event) =>
                      onChange(
                        rows.map((entry, at) =>
                          at === index ? { ...entry, vi: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Label
                    htmlFor={`ai-context-glossary-en-${index}`}
                    className="text-muted-foreground text-hint"
                  >
                    {t('web.preferences.aiContext.glossaryEn')}
                  </Label>
                  <Input
                    id={`ai-context-glossary-en-${index}`}
                    value={row.en}
                    maxLength={CONTEXT_LIMITS.MAX_GLOSSARY_TERM_CHARS}
                    aria-invalid={enTooLong}
                    onChange={(event) =>
                      onChange(
                        rows.map((entry, at) =>
                          at === index ? { ...entry, en: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('web.preferences.aiContext.glossaryRemove')}
                  onClick={() => onChange(rows.filter((_, at) => at !== index))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
              {/* Named to THIS row rather than shown once for the whole
                  list — with 24 pairs on screen, a single message below
                  everything left the writer counting all 48 boxes by
                  hand to find the one it meant. */}
              {viTooLong || enTooLong ? (
                <span className="text-muted-foreground text-hint">
                  {t('web.preferences.aiContext.glossaryTooLong', {
                    max: CONTEXT_LIMITS.MAX_GLOSSARY_TERM_WORDS,
                  })}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={rows.length >= CONTEXT_LIMITS.MAX_GLOSSARY}
        onClick={() => onChange([...rows, { vi: '', en: '' }])}
      >
        <Plus aria-hidden /> {t('web.preferences.aiContext.glossaryAdd')}
      </Button>
    </div>
  );
}
