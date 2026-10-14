/**
 * Minimal typed store with a simple undo/redo history for the quotation.
 *
 * `commit(mutator)` applies a change and records history. Rapid consecutive
 * edits to the same field are coalesced into a single undo step so that
 * Ctrl+Z undoes a whole typing burst, not every keystroke.
 */

export interface CommitMeta {
  /** Optional field key used to coalesce rapid edits into one history entry. */
  field?: string;
  /** Set to true to skip recording this commit in history (undo facade). */
  silent?: boolean;
  /** Set for a redo/undo/load operation: clears the redo stack. */
  clearsRedo?: boolean;
}

export class Store<T extends object, Q> {
  private state: T;
  private listeners = new Set<(s: T) => void>();
  private past: Q[] = [];
  private future: Q[] = [];
  private lastSnapshot: { q: Q; field?: string; at: number } | null = null;
  private readonly maxHistory = 60;
  private readonly coalesceWindowMs = 700;

  /** Keys of state that are part of the undoable document. */
  private readonly documentKey: keyof T & string;
  private readonly clone: (q: Q) => Q;

  constructor(initialState: T, documentKey: keyof T & string, clone: (q: Q) => Q) {
    this.state = initialState;
    this.documentKey = documentKey;
    this.clone = clone;
  }

  get(): T {
    return this.state;
  }

  subscribe(fn: (s: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Replace the whole state (load), not undoable. */
  replace(next: T): void {
    this.state = next;
    this.past = [];
    this.future = [];
    this.lastSnapshot = null;
    this.emit();
  }

  /** Merge non-document state (company settings, save status) — not undoable. */
  patch(partial: Partial<T>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  /** Apply a mutation to the document part of the state, recording history. */
  commit(mutator: (draft: Q) => void, meta: CommitMeta = {}): void {
    const current = this.state[this.documentKey] as Q;
    const before = this.clone(current);
    const draft = this.clone(current);
    mutator(draft);

    if (!meta.silent) {
      this.pushHistory(before, meta);
    }
    if (meta.clearsRedo) this.future = [];

    this.state = { ...this.state, [this.documentKey]: draft };
    this.emit();
  }

  undo(): boolean {
    const snapshot = this.past.pop();
    if (!snapshot) return false;
    const current = this.state[this.documentKey] as Q;
    this.future.push(this.clone(current));
    this.state = { ...this.state, [this.documentKey]: snapshot };
    this.lastSnapshot = null;
    this.emit();
    return true;
  }

  redo(): boolean {
    const snapshot = this.future.pop();
    if (!snapshot) return false;
    const current = this.state[this.documentKey] as Q;
    this.past.push(this.clone(current));
    this.state = { ...this.state, [this.documentKey]: snapshot };
    this.lastSnapshot = null;
    this.emit();
    return true;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  private pushHistory(snapshot: Q, meta: CommitMeta): void {
    const now = Date.now();
    const last = this.lastSnapshot;
    // Coalesce: same field edited again inside the window -> replace last entry.
    if (
      last &&
      last.field === meta.field &&
      last.field !== undefined &&
      now - last.at < this.coalesceWindowMs
    ) {
      this.past[this.past.length - 1] = snapshot;
      this.lastSnapshot = { ...last, at: now };
      return;
    }
    this.past.push(snapshot);
    if (this.past.length > this.maxHistory) this.past.shift();
    this.future = [];
    this.lastSnapshot = { q: snapshot, field: meta.field, at: now };
  }

  private emit(): void {
    const snapshot = this.state;
    for (const fn of this.listeners) fn(snapshot);
  }
}
