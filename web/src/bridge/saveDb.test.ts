import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_SLOTS,
  clientInfo,
  exportFileName,
  gzip,
  hasRoom,
  isGzip,
  labelFromFileName,
  nextAutosaveSlot,
  parseUiExport,
  resolveSlotId,
  sniffImport,
  sortRecords,
  StoreError,
} from './saveDb';

const enc = (s: string) => new TextEncoder().encode(s);

describe('slot ids and the autosave rotation (D17)', () => {
  it('fills unused autosave slots first, then overwrites the least recently written', () => {
    expect(AUTOSAVE_SLOTS).toBe(3);
    expect(nextAutosaveSlot([])).toBe('auto-1');
    expect(nextAutosaveSlot([{ slotId: 'auto-1', updatedAt: 5 }])).toBe('auto-2');
    expect(nextAutosaveSlot([{ slotId: 'auto-1', updatedAt: 5 }, { slotId: 'auto-3', updatedAt: 1 }])).toBe('auto-2');
    const full = [
      { slotId: 'auto-1', updatedAt: 30 },
      { slotId: 'auto-2', updatedAt: 10 },
      { slotId: 'auto-3', updatedAt: 20 },
      { slotId: 'm-x', updatedAt: 1 },
      { slotId: 'quick', updatedAt: 0 },
    ];
    expect(nextAutosaveSlot(full)).toBe('auto-2');
  });

  it('resolves a save request to its slot', () => {
    const records = [{ slotId: 'auto-1', updatedAt: 1 }];
    expect(resolveSlotId('autosave', undefined, records, () => 'u')).toBe('auto-2');
    expect(resolveSlotId('autosave', 'auto-3', records, () => 'u')).toBe('auto-3');
    expect(resolveSlotId('quicksave', undefined, records, () => 'u')).toBe('quick');
    expect(resolveSlotId('manual', undefined, records, () => 'abc')).toBe('m-abc');
    expect(resolveSlotId(undefined, '  m-keep ', records, () => 'abc')).toBe('m-keep');
  });

  it('lists newest first with a stable tie-break', () => {
    const sorted = sortRecords([
      { slotId: 'b', updatedAt: 1 },
      { slotId: 'c', updatedAt: 3 },
      { slotId: 'a', updatedAt: 1 },
    ]);
    expect(sorted.map((r) => r.slotId)).toEqual(['c', 'a', 'b']);
  });
});

describe('files', () => {
  it('names exports <company>-<YYYY-MM>.magnate', () => {
    expect(exportFileName({ companyName: 'Acme Beverages & Co.', date: { year: 2031, month: 4 } })).toBe('acme-beverages-co-2031-04.magnate');
    expect(exportFileName({ companyName: '!!!', date: { year: 2026, month: 12 } })).toBe('magnate-2026-12.magnate');
  });

  it('derives an import label from the file name', () => {
    expect(labelFromFileName('acme-2031-04.magnate')).toBe('acme-2031-04');
    expect(labelFromFileName('C:\\saves\\old game.json')).toBe('old game');
    expect(labelFromFileName('backup.json.gz')).toBe('backup');
    expect(labelFromFileName('x.magnate.json')).toBe('x');
    expect(labelFromFileName(undefined)).toBeNull();
  });

  it('sniffs what an imported file is from its first bytes', async () => {
    expect(sniffImport(new Uint8Array([0x1f, 0x8b, 8, 0]))).toBe('gzip');
    expect(sniffImport(enc('{"format":"magnate.save","formatVersion":1,"meta":{},"data":"{}"}'))).toBe('uiExport');
    expect(sniffImport(enc('\ufeff  {"format":"magnate.websave"}'))).toBe('json');
    expect(sniffImport(enc('{"schemaVersion":9}'))).toBe('json');
    expect(sniffImport(enc('PK\u0003\u0004'))).toBe('unknown');
    expect(sniffImport(new Uint8Array())).toBe('unknown');
    const packed = await gzip(enc('{"schemaVersion":9}'));
    if (packed) {
      expect(isGzip(packed)).toBe(true);
      expect(sniffImport(packed)).toBe('gzip');
    }
  });

  it('unwraps a Wave-1 UI export into the engine text and a client document', () => {
    const file = JSON.stringify({
      format: 'magnate.save',
      formatVersion: 1,
      meta: { label: ' Before the war ', thumbnail: 'data:image/webp;base64,AA', playTimeSec: 99 },
      data: '{"format":"magnate.websave"}',
      sidecar: { version: 1, cityId: 'hilltown' },
    });
    const parsed = parseUiExport(file);
    expect(parsed.data).toBe('{"format":"magnate.websave"}');
    expect(parsed.label).toBe('Before the war');
    expect(parsed.client).toEqual({ version: 1, sidecar: { version: 1, cityId: 'hilltown' }, thumbnail: 'data:image/webp;base64,AA', playTimeSec: 99 });
    expect(() => parseUiExport('{')).toThrow(StoreError);
    expect(() => parseUiExport('{"format":"magnate.save","data":""}')).toThrow(/not a Magnate save/);
    expect(() => parseUiExport('{"format":"magnate.save","formatVersion":2,"data":"{}"}')).toThrow(/newer version/);
  });

  it('reads the listing bits of a client document tolerantly', () => {
    expect(clientInfo('{"version":1,"thumbnail":"data:x","playTimeSec":12.5}')).toEqual({ thumbnail: 'data:x', playTimeSec: 12.5 });
    expect(clientInfo('{"version":1,"playTimeSec":-3}')).toEqual({ thumbnail: null, playTimeSec: 0 });
    expect(clientInfo('not json')).toEqual({ thumbnail: null, playTimeSec: 0 });
    expect(clientInfo(null)).toEqual({ thumbnail: null, playTimeSec: 0 });
  });
});

describe('quota (bridge-spec §6.3)', () => {
  it('needs free space of three times the save', () => {
    expect(hasRoom({ usage: 0, quota: 3_000 }, 1_000)).toBe(true);
    expect(hasRoom({ usage: 1, quota: 3_000 }, 1_000)).toBe(false);
    expect(hasRoom(null, 1e12)).toBe(true);
    expect(hasRoom({ usage: 0, quota: 0 }, 1e12)).toBe(true);
  });
});
