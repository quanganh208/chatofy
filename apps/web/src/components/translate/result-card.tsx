'use client';

import type { TranslateResponse, TranslationDirection } from '@chatofy/types';
import { Card, CardContent, CardHeader, CardTitle } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

interface ResultCardProps {
  result: TranslateResponse;
  direction: TranslationDirection;
}

/** Transcript + translation + playable synthesized audio for a finished turn. */
export function ResultCard({ result, direction }: ResultCardProps) {
  const t = useTranslate();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('web.translate.result')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-label text-muted-foreground uppercase">
            {direction === 'vi_to_en' ? 'Vietnamese' : 'English'}
          </p>
          <p>{result.sourceText}</p>
        </div>
        <div>
          <p className="text-label text-muted-foreground uppercase">
            {direction === 'vi_to_en' ? 'English' : 'Vietnamese'}
          </p>
          <p>{result.targetText}</p>
        </div>
        <audio
          controls
          src={`data:${result.audioMimeType};base64,${result.audioBase64}`}
          className="w-full"
        />
      </CardContent>
    </Card>
  );
}
