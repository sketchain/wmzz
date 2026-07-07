import { describe, expect, it } from 'vitest';
import { CommandStack } from '../src/core/commands/CommandStack';
import type { Command } from '../src/core/commands/Command';

function makeCounterCommand(
  label: string,
  state: { value: number },
  delta: number,
): Command {
  return {
    label,
    execute() {
      state.value += delta;
    },
    undo() {
      state.value -= delta;
    },
  };
}

describe('CommandStack', () => {
  it('executes, undoes and redoes commands', () => {
    const state = { value: 0 };
    const stack = new CommandStack();

    stack.execute(makeCounterCommand('add 5', state, 5));
    stack.execute(makeCounterCommand('add 3', state, 3));
    expect(state.value).toBe(8);
    expect(stack.undoLabel).toBe('add 3');

    expect(stack.undo()).toBe(true);
    expect(state.value).toBe(5);
    expect(stack.redoLabel).toBe('add 3');

    expect(stack.redo()).toBe(true);
    expect(state.value).toBe(8);
  });

  it('clears the redo branch when a new command executes', () => {
    const state = { value: 0 };
    const stack = new CommandStack();
    stack.execute(makeCounterCommand('a', state, 1));
    stack.execute(makeCounterCommand('b', state, 2));
    stack.undo();
    expect(stack.canRedo).toBe(true);

    stack.execute(makeCounterCommand('c', state, 10));
    expect(stack.canRedo).toBe(false);
    expect(state.value).toBe(11);
  });

  it('merges consecutive commands when tryMerge accepts', () => {
    const state = { value: 0 };
    const stack = new CommandStack();

    class BrushStroke implements Command {
      label = 'brush';
      constructor(private amount: number) {}
      execute(): void {
        state.value += this.amount;
      }
      undo(): void {
        state.value -= this.amount;
      }
      tryMerge(next: Command): boolean {
        if (!(next instanceof BrushStroke)) return false;
        this.amount += next.amount;
        return true;
      }
    }

    stack.execute(new BrushStroke(1));
    stack.execute(new BrushStroke(2));
    stack.execute(new BrushStroke(3));
    expect(state.value).toBe(6);
    expect(stack.history.length).toBe(1);

    stack.undo();
    expect(state.value).toBe(0);
  });

  it('drops oldest history beyond capacity', () => {
    const state = { value: 0 };
    const stack = new CommandStack(2);
    stack.execute(makeCounterCommand('a', state, 1));
    stack.execute(makeCounterCommand('b', state, 1));
    stack.execute(makeCounterCommand('c', state, 1));
    expect(stack.history.length).toBe(2);
    expect(stack.history[0].label).toBe('b');
  });

  it('returns false when nothing to undo/redo', () => {
    const stack = new CommandStack();
    expect(stack.undo()).toBe(false);
    expect(stack.redo()).toBe(false);
  });
});
