import type { Metadata } from 'next';
import { GlossaryPageContent } from '@/components/glossary/glossary-page-content';
import { GlossariesProvider } from '@/hooks/use-glossaries';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.glossary') };
}

export default function GlossaryPage() {
  return (
    <GlossariesProvider>
      <GlossaryPageContent />
    </GlossariesProvider>
  );
}
