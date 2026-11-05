/**
 * The translate settings as screen state: read once at mount, written through on
 * every change. Until the stored value is read the screen shows the defaults, and a
 * change made in that gap wins over the late read.
 */

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_TRANSLATE_SETTINGS, type TranslateSettings } from './translate-settings';
import { loadTranslateSettings, saveTranslateSettings } from './translate-settings-store';

export function useTranslateSettings(): {
  settings: TranslateSettings;
  loaded: boolean;
  update: (change: (current: TranslateSettings) => TranslateSettings) => void;
} {
  const [settings, setSettings] = useState<TranslateSettings>(DEFAULT_TRANSLATE_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadTranslateSettings().then((stored) => {
      if (cancelled) return;
      // `loaded` flips with the read; a change made before it was made on the defaults and is kept.
      setSettings((current) => (current === DEFAULT_TRANSLATE_SETTINGS ? stored : current));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((change: (current: TranslateSettings) => TranslateSettings) => {
    setSettings((current) => {
      const next = change(current);
      void saveTranslateSettings(next);
      return next;
    });
  }, []);

  return { settings, loaded, update };
}
