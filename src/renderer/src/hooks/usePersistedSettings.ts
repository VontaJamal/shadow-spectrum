import { useCallback, useState } from 'react';

type SetState<T> = T | ((current: T) => T);

export function usePersistedSettings<T extends object>(
  storageKey: string,
  defaultValue: T,
  normalize: (value: T) => T = (value) => value
): [T, (value: SetState<T>) => void] {
  const [settings, setSettingsState] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      const merged = stored ? { ...defaultValue, ...JSON.parse(stored) } : defaultValue;
      const normalized = normalize(merged);
      if (stored && JSON.stringify(normalized) !== JSON.stringify(merged)) {
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
