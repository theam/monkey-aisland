/**
 * Game state: flags, inventory, and where we are.
 *
 * Deliberately NOT persisted. The game is a few minutes long and the intro is
 * part of the joke, so every visit starts from the top of the path. Only the
 * sound preference survives a reload, because nobody wants the music to come
 * back after they muted it.
 */
const LEGACY_SAVE_KEY = 'monkey-aisland.save.v1'
const PREF_KEY = 'monkey-aisland.prefs.v1'

export type InventoryItem = {
  id: string
  name: string
}

export type Prefs = {
  music: boolean
  sfx: boolean
  volume: number
}

export class GameState {
  scene = ''
  flags = new Set<string>()
  inventory: InventoryItem[] = []
  visited = new Set<string>()
  /** counter per default-line pool so the sarcasm rotates instead of repeating */
  private cycles = new Map<string, number>()
  /**
   * Called once for each flag the first time it is set. The game uses it to
   * count the handful of flags that mark real progress; it is deliberately a
   * plain callback so state stays ignorant of what analytics is.
   */
  onFirstSet: ((flag: string) => void) | null = null

  has(flag: string): boolean {
    return this.flags.has(flag)
  }

  set(flags: string[] | undefined): void {
    for (const f of flags ?? []) {
      const isNew = !this.flags.has(f)
      this.flags.add(f)
      if (isNew) this.onFirstSet?.(f)
    }
  }

  clear(flags: string[] | undefined): void {
    for (const f of flags ?? []) this.flags.delete(f)
  }

  /** `if` = all must be set, `unless` = none may be set. */
  test(cond: { if?: string[]; unless?: string[] } | undefined): boolean {
    if (!cond) return true
    if (cond.if && !cond.if.every((f) => this.flags.has(f))) return false
    if (cond.unless && cond.unless.some((f) => this.flags.has(f))) return false
    return true
  }

  give(item: InventoryItem): void {
    if (!this.inventory.some((i) => i.id === item.id)) this.inventory.push(item)
  }

  take(id: string): void {
    this.inventory = this.inventory.filter((i) => i.id !== id)
  }

  hasItem(id: string): boolean {
    return this.inventory.some((i) => i.id === id)
  }

  /** Rotate through a pool of lines deterministically (no repeats in a row). */
  cycle<T>(key: string, pool: readonly T[]): T {
    if (pool.length === 0) throw new Error(`empty line pool: ${key}`)
    const n = this.cycles.get(key) ?? 0
    this.cycles.set(key, n + 1)
    return pool[n % pool.length]
  }

  /**
   * Earlier builds persisted progress. Clear it so anyone who played one of
   * those doesn't get dropped into the middle of the island forever.
   */
  static clearLegacySave(): void {
    try {
      localStorage.removeItem(LEGACY_SAVE_KEY)
    } catch {
      /* private browsing, quota, whatever — the game still works */
    }
  }
}

export function loadPrefs(fallback: Prefs): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    if (!raw) return { ...fallback }
    const p = JSON.parse(raw) as Partial<Prefs>
    return {
      music: p.music ?? fallback.music,
      sfx: p.sfx ?? fallback.sfx,
      volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : fallback.volume,
    }
  } catch {
    return { ...fallback }
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}
