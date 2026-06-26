import { useCallback, useState } from 'react';

type SetState<T> = T | ((current: T) => T);

interface PersistedSettingsOptions {
  legacyKeys?: string[];
}

export function usePersistedSettings<T extends object>(
  storageKey: string,
  defaultValue: T,
  normalize: (value: T) => T = (value) => value,
  options: PersistedSettingsOptions = {}
): [T, (value: SetState<T>) => void] {
  const [settings, setSettingsState] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      const hasStoredSettings = stored !== null;
      const legacyKey = hasStoredSettings
        ? undefined
        : options.legacyKeys?.find((key) => window.localStorage.getItem(key) !== null);
      const legacyStored = legacyKey ? window.localStorage.getItem(legacyKey) : null;
      const storedSettings = hasStoredSettings ? stored : legacyStored;
      const merged = storedSettings !== null ? { ...defaultValue, ...JSON.parse(storedSettings) } : defaultValue;
      const normalized = normalize(merged);
      if (legacyKey) {
        window.localStorage.setItem(storageKey, JSON.stringify(normalized));
        window.localStorage.removeItem(legacyKey);
      } else if (stored && JSON.stringify(normalized) !== JSON.stringify(merged)) {
        window.localStorage.setItem(storageKey, JSON.stringify(normalized));
      }
      return normalized;
    } catch {
      return defaultValue;
    }
  });

  const setSettings = useCallback(
    (value: SetState<T>) => {
      setSettingsState((current) => {
        const next = normalize(typeof value === 'function' ? (value as (existing: T) => T)(current) : value);
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    },
    [normalize, storageKey]
  );

  return [settings, setSettings];
}
