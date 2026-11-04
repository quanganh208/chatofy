'use client';

import { Badge } from '@chatofy/ui/react';
import { LANGUAGES } from '@chatofy/types';
import type { Glossary } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

interface Props {
  glossary: Glossary;
}

export function GlossaryDetailHeader({ glossary }: Props) {
  const t = useTranslate();
  const langLabel = LANGUAGES[glossary.sourceLang]?.label ?? glossary.sourceLang;

  return (
    <div className="flex items-start justify-between px-4 py-3 border-b gap-3">
      <div className="min-w-0">
        <h3 className="font-semibold truncate">{glossary.name}</h3>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant={glossary.isActive ? 'default' : 'secondary'} className="text-hint">
            {glossary.isActive ? t('web.glossary.badgeActive') : t('web.glossary.badgeInactive')}
          </Badge>
          <span className="text-hint text-muted-foreground">{langLabel}</span>
        </div>
        {glossary.description && (
          <p className="text-hint text-muted-foreground mt-1 line-clamp-2">
            {glossary.description}
          </p>
        )}
      </div>
    </div>
  );
}
