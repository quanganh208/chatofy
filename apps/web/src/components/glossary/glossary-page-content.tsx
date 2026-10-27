'use client';

import { useState } from 'react';
import { useGlossaries } from '@/hooks/use-glossaries';
import { GlossaryDetailPanel } from './glossary-detail-panel';
import { GlossaryListPanel } from './glossary-list-panel';

/**
 * Two-panel glossary surface: left panel lists glossaries, right panel shows the
 * selected glossary's terms. Both panels scroll independently within the content area.
 *
 * State lives here so that GlossariesProvider does not need to know about selection —
 * selection is purely a local UI concern while the glossary list is shared data.
 */
export function GlossaryPageContent() {
  const { glossaries, status, save, patch, remove } = useGlossaries();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedGlossary = glossaries.find((g) => g.id === selectedId) ?? null;

  async function handleDelete(glossaryId: string) {
    await remove(glossaryId);
    if (selectedId === glossaryId) setSelectedId(null);
  }

  async function handleToggleActive(glossaryId: string) {
    const g = glossaries.find((x) => x.id === glossaryId);
    if (!g) return;
    await patch(glossaryId, { isActive: !g.isActive });
  }

  return (
    <div className="flex border rounded-lg overflow-hidden h-[calc(100svh-12rem)] -mx-6">
      <GlossaryListPanel
        glossaries={glossaries}
        status={status}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onSave={save}
        onToggleActive={handleToggleActive}
        onDelete={handleDelete}
      />
      <GlossaryDetailPanel glossary={selectedGlossary} onPatch={patch} />
    </div>
  );
}
