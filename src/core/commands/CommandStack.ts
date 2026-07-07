import type { Command } from './Command';
import type { GameEventBus } from '../events/GameEvents';

/**
 * Undo/redo stack with optional command coalescing and bounded history.
 * Executing a new command clears the redo branch (linear history model,
 * same as Cities: Skylines and most editors).
 */
export class CommandStack {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];

  constructor(
    private readonly capacity = 256,
    private readonly events?: GameEventBus,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }

  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  get history(): readonly Command[] {
    return this.undoStack;
  }

  execute(command: Command): void {
    command.execute();
    this.redoStack.length = 0;

    const top = this.undoStack[this.undoStack.length - 1];
    if (top?.tryMerge && top.tryMerge(command)) {
      this.events?.emit('command:executed', { label: top.label });
      return;
    }

    this.undoStack.push(command);
    if (this.undoStack.length > this.capacity) this.undoStack.shift();
    this.events?.emit('command:executed', { label: command.label });
  }

  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo();
    this.redoStack.push(command);
    this.events?.emit('command:undone', { label: command.label });
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.execute();
    this.undoStack.push(command);
    this.events?.emit('command:redone', { label: command.label });
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
