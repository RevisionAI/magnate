import { describe, expect, it, vi } from 'vitest';
import { GameClock, SECONDS_PER_MONTH, SPEED_MULTIPLIER, dayOfMonth, daysUntilClose } from './clock';

describe('D5 time model', () => {
  it('uses 12 / 6 / 3 / 1.5 seconds per month at 1× / 2× / 4× / 8×', () => {
    expect(SECONDS_PER_MONTH[1]).toBe(12);
    expect(SECONDS_PER_MONTH[2]).toBe(6);
    expect(SECONDS_PER_MONTH[3]).toBe(3);
    expect(SECONDS_PER_MONTH[4]).toBe(1.5);
    expect(SPEED_MULTIPLIER).toEqual({ 0: 0, 1: 1, 2: 2, 3: 4, 4: 8 });
  });

  it('maps progress to a 30-day visual clock', () => {
    expect(dayOfMonth(0)).toBe(1);
    expect(dayOfMonth(0.5)).toBe(16);
    expect(dayOfMonth(0.999)).toBe(30);
    expect(dayOfMonth(1)).toBe(30);
    expect(daysUntilClose(0)).toBe(30);
    expect(daysUntilClose(0.7)).toBe(9);
  });
});

describe('GameClock', () => {
  it('does not advance while paused', () => {
    const tick = vi.fn(async () => {});
    const clock = new GameClock(tick);
    clock.update(100);
    expect(clock.progress).toBe(0);
    expect(tick).not.toHaveBeenCalled();
  });

  it('advances 1/12 of a month per second at 1× and closes the month once', async () => {
    let resolveTick: () => void = () => {};
    const tick = vi.fn(() => new Promise<void>((r) => (resolveTick = r)));
    const clock = new GameClock(tick);
    clock.setSpeed(1);
    for (let i = 0; i < 4 * 6; i++) clock.update(0.25); // 6 s
    expect(clock.progress).toBeCloseTo(0.5, 5);
    for (let i = 0; i < 4 * 7; i++) clock.update(0.25); // past the month end
    expect(tick).toHaveBeenCalledTimes(1);
    expect(clock.busy).toBe(true);
    expect(clock.day).toBe(30); // holds at day 30 while the engine ticks
    clock.update(1);
    expect(tick).toHaveBeenCalledTimes(1);
    resolveTick();
    await Promise.resolve();
    await Promise.resolve();
    expect(clock.busy).toBe(false);
    expect(clock.progress).toBe(0);
  });

  it('clamps long frames so a backgrounded tab cannot skip months', () => {
    const tick = vi.fn(async () => {});
    const clock = new GameClock(tick);
    clock.setSpeed(4); // 8× = 1.5 s/month
    clock.update(30);
    expect(clock.progress).toBeCloseTo(0.25 / 1.5, 5);
    expect(tick).not.toHaveBeenCalled();
  });

  it('steps exactly one month on demand and survives tick failures', async () => {
    const tick = vi.fn(async () => {
      throw new Error('boom');
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const clock = new GameClock(tick);
    expect(await clock.closeMonth()).toBe(true);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(clock.busy).toBe(false);
    expect(clock.progress).toBe(0);
    errors.mockRestore();
  });
});
