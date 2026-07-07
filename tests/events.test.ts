import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events/EventBus';

interface TestEvents {
  ping: { value: number };
  pong: { value: number };
}

describe('EventBus', () => {
  it('dispatches synchronously to subscribers', () => {
    const bus = new EventBus<TestEvents>();
    const received: number[] = [];
    bus.on('ping', (p) => received.push(p.value));
    bus.emit('ping', { value: 1 });
    bus.emit('ping', { value: 2 });
    expect(received).toEqual([1, 2]);
  });

  it('unsubscribes via the returned handle and via off()', () => {
    const bus = new EventBus<TestEvents>();
    let count = 0;
    const handler = (): void => {
      count++;
    };
    const unsubscribe = bus.on('ping', handler);
    bus.emit('ping', { value: 0 });
    unsubscribe();
    bus.emit('ping', { value: 0 });
    expect(count).toBe(1);

    bus.on('ping', handler);
    bus.off('ping', handler);
    bus.emit('ping', { value: 0 });
    expect(count).toBe(1);
  });

  it('once() fires exactly one time', () => {
    const bus = new EventBus<TestEvents>();
    let count = 0;
    bus.once('ping', () => count++);
    bus.emit('ping', { value: 0 });
    bus.emit('ping', { value: 0 });
    expect(count).toBe(1);
  });

  it('defers enqueued events until flush', () => {
    const bus = new EventBus<TestEvents>();
    const received: number[] = [];
    bus.on('ping', (p) => received.push(p.value));

    bus.enqueue('ping', { value: 7 });
    expect(received).toEqual([]);
    expect(bus.pending).toBe(1);

    bus.flush();
    expect(received).toEqual([7]);
    expect(bus.pending).toBe(0);
  });

  it('delivers events enqueued during a flush within the same flush', () => {
    const bus = new EventBus<TestEvents>();
    const received: string[] = [];
    bus.on('ping', (p) => {
      received.push(`ping:${p.value}`);
      if (p.value < 2) bus.enqueue('pong', { value: p.value + 1 });
    });
    bus.on('pong', (p) => {
      received.push(`pong:${p.value}`);
      bus.enqueue('ping', { value: p.value + 1 });
    });

    bus.enqueue('ping', { value: 0 });
    bus.flush();
    expect(received).toEqual(['ping:0', 'pong:1', 'ping:2']);
  });

  it('throws on unbounded event feedback loops', () => {
    const bus = new EventBus<TestEvents>();
    bus.on('ping', () => bus.enqueue('ping', { value: 0 }));
    bus.enqueue('ping', { value: 0 });
    expect(() => bus.flush(4)).toThrow(/feedback loop/);
  });
});
