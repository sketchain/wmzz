/**
 * Command pattern contract used by every user-initiated world mutation
 * (terrain edits, road building, zoning, bulldozing…), giving uniform
 * undo/redo across all tools.
 */
export interface Command {
  /** Human-readable label shown in UI history / tooltips. */
  readonly label: string;

  /** Apply the mutation. Called once on execute and again on redo. */
  execute(): void;

  /** Revert the mutation. Must restore the exact prior state. */
  undo(): void;

  /**
   * Optional coalescing: return true if `next` was absorbed into this
   * command (e.g. continuous terrain brush strokes merge into one undo step).
   */
  tryMerge?(next: Command): boolean;
}
