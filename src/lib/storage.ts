export const loadState = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const saveState = <T>(key: string, value: T) => {
  localStorage.setItem(key, JSON.stringify(value));
};

export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export const pesos = (amount: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(amount);

export const fixed2 = (value: number) => value.toFixed(2);
