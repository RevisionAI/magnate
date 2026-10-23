import { describe, expect, it } from 'vitest';
import type { SaveGameResult, SnapshotDto } from '@/bridge/protocol';
import { toHudModel } from './hud';
import { MemorySaveStore } from './savegame/memorySaveStore';
import { buildMeta, nextAutosaveSlot, parseImport, slotIds, slotKindOf, slotTitle, sortSlots } from './savegame/meta';
import { SaveError, type SaveEngine, type SaveSlotMeta } from './savegame/types';

const snapshot = {
  date: { year: 2027, month: 4 },
  monthIndex: 15,
  playerId: 1,
  revision: 3,
  companies: [
    { id: 1, name: 'Acme Beverages', isPlayer: true, cash: 9e6, totalAssets: 12e6, equity: 12e6, revenueThisMonth: 1e6, netIncomeThisMonth: 2e5, buildingCount: 2, color: '#2f7de1' },
  ],
  scenario: { id: 'tutorial', name: 'Tutorial', goals: [{ description: 'a', achieved: true, progress: 1, detail: '' }, { description: 'b', achieved: false, progress: 0.2, detail: '' }] },
} as unknown as SnapshotDto;

function fakeEngine(): SaveEngine & { loads: string[] } {
  let n = 0;
  const loads: string[] = [];
  return {
    loads,
    async saveGame(): Promise<SaveGameResult> {
      n++;
      return { data: `{"schemaVersion":9,"n":${n}}`, schemaVersion: 9, scenarioId: 'tutorial', scenarioName: 'Tutorial', companyName: 'Acme Beverages', date: { year: 2027, month: 4 }, cash: 9e6 };
    },
    async loadGame(data: string): Promise<SnapshotDto> {
      loads.push(data);
      if (data.includes('broken')) throw new Error('save_corrupt');
      return snapshot;
    },
  };
}

const ctx = (over: Partial<Parameters<typeof buildMeta>[2]> = {}) => ({
  slotKind: 'manual' as const,
  gameId: 'game-1',
  hud: toHudModel(snapshot),
  playTimeSec: 125.4,
  ...over,
});

describe('save metadata', () => {
  it('builds listing metadata without parsing the body', () => {
    const engine = fakeEngine();
    return engine.saveGame().then((result) => {
      const meta = buildMeta('m-1', result, ctx({ label: 'Before the expansion' }), 1_000);
      expect(meta).toMatchObject({
        slotId: 'm-1',
        slotKind: 'manual',
        label: 'Before the expansion',
        gameId: 'game-1',
        companyName: 'Acme Beverages',
        date: { year: 2027, month: 4 },
        corporateValue: 12e6,
        goalsAchieved: 1,
        goalsTotal: 2,
        outcomeStatus: 'playing',
        playTimeSec: 125,
        engineSchemaVersion: 9,
        updatedAt: 1_000,
      });
      expect(meta.rawBytes).toBe(result.data.length);
    });
  });

  it('names and classifies slots', () => {
    expect(slotIds.quick('game-1')).toBe('quick-game-1');
    expect(slotKindOf('auto-2')).toBe('autosave');
    expect(slotKindOf('quick-game-1')).toBe('quicksave');
    expect(slotKindOf(slotIds.manual())).toBe('manual');
    expect(slotTitle({ slotKind: 'quicksave', label: null, companyName: 'X', scenarioName: null })).toBe('Quicksave');
    expect(slotTitle({ slotKind: 'manual', label: null, companyName: 'Acme', scenarioName: 'Tutorial' })).toBe('Acme · Tutorial');
  });

  it('rotates autosaves through three slots, oldest first', () => {
    const m = (slotId: string, updatedAt: number) => ({ slotId, slotKind: 'autosave', updatedAt }) as SaveSlotMeta;
    expect(nextAutosaveSlot([])).toBe('auto-1');
    expect(nextAutosaveSlot([m('auto-1', 5)])).toBe('auto-2');
    expect(nextAutosaveSlot([m('auto-1', 5), m('auto-2', 2), m('auto-3', 9)])).toBe('auto-2');
  });

  it('parses exports and legacy engine saves, rejects junk', () => {
    const legacy = parseImport('{"schemaVersion":9,"clock":{"year":2028,"month":7},"playerId":1,"companies":[{"id":1,"name":"Old Co","cash":5}]}', 'old.json', 0);
    expect(legacy.meta.companyName).toBe('Old Co');
    expect(legacy.meta.date).toEqual({ year: 2028, month: 7 });
    expect(legacy.meta.label).toBe('old');
    expect(() => parseImport('not json')).toThrow(SaveError);
    expect(() => parseImport('{"hello":1}')).toThrow(/not a Magnate save/);
    expect(() => parseImport(JSON.stringify({ format: 'magnate.save', formatVersion: 99, meta: {}, data: '{}' }))).toThrow(/newer version/);
  });
});

describe('MemorySaveStore', () => {
  it('saves, lists newest first, renames, loads and deletes', async () => {
    const engine = fakeEngine();
    const store = new MemorySaveStore(engine);
    const a = await store.save('m-a', ctx());
    await new Promise((r) => setTimeout(r, 2));
    const q = await store.save(slotIds.quick('game-1'), ctx({ slotKind: 'quicksave', sidecar: { version: 1, cityId: 'metropolis' } }));
    const list = await store.list();
    expect(list.map((m) => m.slotId)).toEqual([q.slotId, a.slotId]);
    expect(sortSlots(list)).toEqual(list);

    const renamed = await store.rename('m-a', '  Big bet  ');
    expect(renamed.label).toBe('Big bet');

    const loaded = await store.load(q.slotId);
    expect(loaded.snapshot.monthIndex).toBe(15);
    expect(loaded.sidecar?.cityId).toBe('metropolis');
    expect(engine.loads).toHaveLength(1);

    await store.remove('m-a');
    expect((await store.list()).map((m) => m.slotId)).toEqual([q.slotId]);
    await expect(store.load('m-a')).rejects.toThrow(/no longer exists/);
  });

  it('round-trips through export/import as a new manual slot', async () => {
    const store = new MemorySaveStore(fakeEngine());
    await store.save('m-a', ctx());
    const { blob, fileName } = await store.exportSlot('m-a');
    expect(fileName).toBe('acme-beverages-2027-04.magnate.json');
    const imported = await store.importFile(blob, fileName);
    expect(imported.slotKind).toBe('manual');
    expect(imported.slotId).not.toBe('m-a');
    expect((await store.list())).toHaveLength(2);
  });
});
