import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFixtures, fixtureExport } from './exports';
import { type CardRecord } from './generator';
const record: CardRecord = { number: '4242420000000000', month: '01', year: '29', cvv: '007', network: 'Visa', synthetic: true };
describe('download exports', () => {
  it('exports TXT with no header and one record per line', () => expect(fixtureExport([record, record], 'txt')).toEqual({ filename: 'fixture-test-data.txt', mime: 'text/plain', content: '4242420000000000 | 01/29 | 007\n4242420000000000 | 01/29 | 007' }));
  it('exports four CSV columns, preserving leading zeros', () => expect(fixtureExport([record], 'csv')).toEqual({ filename: 'fixture-test-data.csv', mime: 'text/csv', content: '4242420000000000,01,29,007' }));
  it('exports labeled synthetic JSON with string values', () => { const file = fixtureExport([record], 'json'); expect(file.mime).toBe('application/json'); expect(JSON.parse(file.content)).toEqual([record]); });
});
describe('browser download', () => {
  /** Captures what the download path actually asks the browser to do. */
  function harness() {
    const clicks: unknown[] = [];
    const removed: unknown[] = [];
    const anchor = { href: '', download: '', click: () => { clicks.push(anchor); }, remove: () => { removed.push(anchor); } };
    const appended: unknown[] = [];
    const blobs: { parts: unknown[]; type: string }[] = [];
    vi.stubGlobal('document', { createElement: () => anchor, body: { append: (...nodes: unknown[]) => { appended.push(...nodes); } } });
    vi.stubGlobal('Blob', class {
      constructor(parts: unknown[], options?: { type?: string }) {
        const entry = { parts, type: options?.type ?? '' };
        blobs.push(entry);
        return entry;
      }
    });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:origen/1'), revokeObjectURL: vi.fn() });
    vi.useFakeTimers();
    return { anchor, clicks, removed, appended, blobs, url: globalThis.URL };
  }
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('builds a blob, triggers the anchor and revokes the object URL', async () => {
    const context = harness();
    downloadFixtures([record, record], 'csv');
    // The blob carries the exported content and a charset-qualified MIME type.
    expect(context.blobs).toHaveLength(1);
    expect(context.blobs[0].parts).toEqual(['4242420000000000,01,29,007\n4242420000000000,01,29,007']);
    expect(context.blobs[0].type).toBe('text/csv;charset=utf-8');
    expect(context.url.createObjectURL).toHaveBeenCalledTimes(1);
    // The anchor is named for the export type, attached, clicked, then detached.
    expect(context.anchor.href).toBe('blob:origen/1');
    expect(context.anchor.download).toBe('fixture-test-data.csv');
    expect(context.appended).toEqual([context.anchor]);
    expect(context.clicks).toEqual([context.anchor]);
    expect(context.removed).toEqual([context.anchor]);
    // The URL is only released after the download has been handed to the browser.
    vi.advanceTimersByTime(999);
    expect(context.url.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(context.url.revokeObjectURL).toHaveBeenCalledWith('blob:origen/1');
  });
  it.each([
    ['txt', 'fixture-test-data.txt', 'text/plain;charset=utf-8'],
    ['csv', 'fixture-test-data.csv', 'text/csv;charset=utf-8'],
    ['json', 'fixture-test-data.json', 'application/json;charset=utf-8'],
  ] as const)('names and types the %s export correctly', (type, filename, mime) => {
    const context = harness();
    downloadFixtures([record], type);
    expect(context.anchor.download).toBe(filename);
    expect(context.blobs).toHaveLength(1);
    expect(context.blobs[0].type).toBe(mime);
    expect(context.url.revokeObjectURL).not.toHaveBeenCalled();
  });
  it('exports an empty record list without throwing', () => {
    const context = harness();
    downloadFixtures([], 'txt');
    expect(context.blobs[0].parts).toEqual(['']);
    expect(context.clicks).toHaveLength(1);
  });
});
