'use client';

import { useState } from 'react';
import { Badge } from '@chatofy/ui/react';
import { LANGUAGES } from '@chatofy/types';
import type { Glossary } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

interface Props {
  glossary: Glossary;
  onSetDefault: (isDefault: boolean) => Promise<void>;
}

export function GlossaryDetailHeader({ glossary, onSetDefault }: Props) {
  const t = useTranslate();
  const [pending, setPending] = useState(false);
  const langLabel =
    LANGUAGES[glossary.sourceLang as keyof typeof LANGUAGES]?.label ?? glossary.sourceLang;

  async function handleToggleDefault(checked: boolean) {
    setPending(true);
    try {
      await onSetDefault(checked);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-start justify-between px-4 py-3 border-b gap-3">
      <div className="min-w-0">
        <h3 className="font-semibold truncate">{glossary.name}</h3>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant={glossary.isActive ? 'default' : 'secondary'} className="text-xs">
            {glossary.isActive ? t('web.glossary.badgeActive') : t('web.glossary.badgeInactive')}
          </Badge>
          <span className="text-xs text-muted-foreground">{langLabel}</span>
        </div>
        {glossary.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{glossary.description}</p>
        )}
      </div>
      <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none text-sm whitespace-nowrap">
        <input
          type="checkbox"
          checked={glossary.isDefault}
          disabled={pending}
          onChange={(e) => void handleToggleDefault(e.target.checked)}
          className="h-4 w-4 rounded border-input accent-primary"
        />
        {t('web.glossary.setDefault')}
      </label>
    </div>
  );
}
