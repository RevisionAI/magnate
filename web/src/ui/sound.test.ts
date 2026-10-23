import { afterEach, describe, expect, it, vi } from 'vitest';
import { audio } from '@/audio';
import { audioContextState, installAudioUnlock, uiSound } from './sound';

describe('audio glue', () => {
  afterEach(() => vi.restoreAllMocks());

  it('initialises audio once, on the first gesture', () => {
    const init = vi.spyOn(audio, 'init').mockResolvedValue(undefined);
    const target = new EventTarget();
    installAudioUnlock(target as unknown as Window);
    expect(init).not.toHaveBeenCalled();
    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('keydown'));
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('forwards extended cues and never throws', () => {
    const ui = vi.spyOn(audio, 'ui').mockImplementation(() => {
      throw new Error('boom');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => uiSound('tab')).not.toThrow();
    expect(ui).toHaveBeenCalledWith('tab', undefined);
  });

  it('reports the context state when the engine exposes it', () => {
    expect(typeof audioContextState()).toBe('string');
  });
});
