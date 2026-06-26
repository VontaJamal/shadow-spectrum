export class SeededPrng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let mixed = this.state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  integer(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  fork(label: string | number): SeededPrng {
    return new SeededPrng(deriveSeed(this.state, label));
  }
}

export function createSessionSeed(pinnedSeed = resolvePinnedVisualSeed()): number {
  if (typeof pinnedSeed === 'number' && Number.isFinite(pinnedSeed)) {
    return pinnedSeed >>> 0;
  }

  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    const values = new Uint32Array(1);
    cryptoObject.getRandomValues(values);
    return values[0] >>> 0;
  }

  return hashString(`${Date.now()}:${globalThis.performance?.now?.() ?? 0}`);
}

export function resolvePinnedVisualSeed(search = globalThis.location?.search ?? ''): number | null {
  const params = new URLSearchParams(search);
  const raw = params.get('visualSeed');
  if (!raw) {
    return null;
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric >>> 0;
  }

  return hashString(raw);
}

export function deriveSeed(parentSeed: number, label: string | number): number {
  return hashString(`${parentSeed >>> 0}:${String(label)}`);
}

export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
