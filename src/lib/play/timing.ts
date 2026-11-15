export interface MatchTiming {
  selectionMs: number | null;
  responseMs: number | null;
}

/** Transient monotonic time only; a resumed or interrupted board stays untrusted. */
export class BoardTiming {
  private valid = false;
  private elapsed = 0;
  private runningSince: number | null = null;
  private selections = new Map<string, number>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  start(valid: boolean): void {
    this.valid = valid;
    this.elapsed = 0;
    this.runningSince = null;
    this.selections.clear();
  }

  resume(): void {
    if (this.valid && this.runningSince === null) this.runningSince = this.now();
  }

  pause(): void {
    if (this.runningSince === null) return;
    const delta = this.now() - this.runningSince;
    this.runningSince = null;
    if (!Number.isFinite(delta) || delta < 0) this.invalidate();
    else this.elapsed += delta;
  }

  invalidate(): void {
    this.valid = false;
    this.runningSince = null;
  }

  private activeTime(): number | null {
    if (!this.valid) return null;
    const delta = this.runningSince === null ? 0 : this.now() - this.runningSince;
    if (!Number.isFinite(delta) || delta < 0) {
      this.invalidate();
      return null;
    }
    return this.elapsed + delta;
  }

  select(wordId: string): void {
    const elapsed = this.activeTime();
    // Cancelling, changing sides and correcting never replace the first selection.
    if (elapsed !== null && !this.selections.has(wordId)) this.selections.set(wordId, elapsed);
  }

  evidence(wordId: string): MatchTiming {
    const elapsed = this.activeTime();
    const selected = this.selections.get(wordId);
    if (elapsed === null || selected === undefined) return { selectionMs: null, responseMs: null };
    return { selectionMs: selected, responseMs: elapsed - selected };
  }
}
