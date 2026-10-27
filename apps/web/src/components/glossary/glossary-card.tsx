'use client';

import { useState } from 'react';
import { Power, Trash2 } from 'lucide-react';
import { Badge, Button } from '@chatofy/ui/react';
import { LANGUAGES } from '@chatofy/types';
import type { Glossary } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

interface Props {
  glossary: Glossary;
  isSelected: boolean;
  onSelect: () => void;
  onToggleActive: () => Promise<void>;
  onDelete: () => Promise<void>;
}

export function GlossaryCard({ glossary, isSelected, onSelect, onToggleActive, onDelete }: Props) {
  const t = useTranslate();
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const langLabel =
    LANGUAGES[glossary.sourceLang as keyof typeof LANGUAGES]?.label ?? glossary.sourceLang;

  async function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    setToggling(true);
    try {
      await onToggleActive();
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-full text-left rounded-lg border px-3 py-2.5 transition-colors',
        isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate text-sm">{glossary.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {langLabel} Â· {t('web.glossary.termCount', { count: glossary.itemCount })}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant={glossary.isActive ? 'default' : 'secondary'} className="text-xs">
            {glossary.isActive ? t('web.glossary.badgeActive') : t('web.glossary.badgeInactive')}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={toggling}
            onClick={handleToggle}
            title={t('web.glossary.toggleActive')}
          >
            <Power className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive"
            disabled={deleting}
            onClick={handleDelete}
            title={t('web.glossary.delete')}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </button>
  );
}
