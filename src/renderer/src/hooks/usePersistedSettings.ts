import { useCallback, useState } from 'react';

type SetState<T> = T | ((current: T) => T);

export function usePersistedSettings<T extends object>(
  storageKey: string,
  defaultValue: T
): [T, (value: SetState<T>) => void] {
  const [settings, setSettingsState] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored ? { ...defaultValue, ...JSON.parse(stored) } : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setSettings = useCallback(
    (value: SetState<T>) => {
      setSettingsState((current) => {
        const next = typeof value === 'function' ? (value as (existing: T) => T)(current) : value;
        window.localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    },
    [storageKey]
  );

  return [settings, setSettings];
}

