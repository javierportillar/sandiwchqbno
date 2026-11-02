export type StorageReadError = 'unavailable' | 'invalid-json' | 'invalid-shape';
export type StorageReadResult<T> =
  | { ok: true; value: T; source: 'stored' | 'absent'; raw: string | null }
  | { ok: false; error: StorageReadError };

export const loadState = <T>(key: string, fallback: T): StorageReadResult<T> => {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  if (raw === null) return { ok: true, value: fallback, source: 'absent', raw };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  const validShape = Array.isArray(fallback)
    ? Array.isArray(value)
    : typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!validShape) return { ok: false, error: 'invalid-shape' };
  return { ok: true, value: value as T, source: 'stored', raw };
};

export type StorageSnapshot = Record<string, string | null>;

export const checkSnapshot = (expected: StorageSnapshot): 'changed' | 'unavailable' | null => {
  try {
    for (const [key, raw] of Object.entries(expected)) {
      if (localStorage.getItem(key) !== raw) return 'changed';
    }
    return null;
  } catch {
    return 'unavailable';
  }
};

export const saveState = <T>(key: string, value: T): { ok: true; raw: string } | { ok: false } => {
  try {
    const raw = JSON.stringify(value);
    if (raw === undefined) return { ok: false };
    localStorage.setItem(key, raw);
    return { ok: true, raw };
  } catch {
    return { ok: false };
  }
};

export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export const pesos = (amount: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(amount);

export const fixed2 = (value: number) => value.toFixed(2);
