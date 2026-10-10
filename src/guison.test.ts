import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkApiStatus, formatMetadata, GUISON_ORIGIN, LOOKUP_TIMEOUT_MS, lookupBin, LookupHistory, metadataEntries, parseMetadata } from './guison';
import { guisonFixture } from '../tests/fixtures/guison';
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('Guison response mapping', () => {
  it('maps the documented schema, including product level and nested metadata', () => {
    const data = parseMetadata(guisonFixture(), '424242');
    expect(data).toMatchObject({ bin: '424242', scheme: 'visa', brand: 'QA Test Brand', type: 'debit', product: 'Test product', issuer: 'Fictional QA Issuer', country: 'Denmark', flag: '🇩🇰', currency: 'DKK', numberLength: 16, luhn: true, prepaid: false });
    expect(data.raw).toEqual(guisonFixture());
  });
  it('preserves false and renders unknowns without inventing values', () => {
    const data = parseMetadata({ iin: '424242', number: { length: null, luhn: false }, country: null, bank: {}, scheme: '', prepaid: null }, '424242');
    expect(data.country).toBeNull(); expect(data.scheme).toBeNull(); expect(data.numberLength).toBeNull();
    expect(metadataEntries(data)).toContainEqual(['Luhn compatibility', 'No']); expect(metadataEntries(data)).toContainEqual(['Prepaid', 'Unknown']);
  });
  it('derives a flag only from a supplied ISO code', () => expect(parseMetadata({ iin: '424242', country: { alpha2: 'IN' } }, '424242').flag).toBe('🇮🇳'));
  it('keeps additional inert metadata in JSON and text exports', () => {
    const data = parseMetadata({ ...guisonFixture(), extra: { label: '<script>not HTML</script>' } }, '424242');
    expect(JSON.parse(formatMetadata(data, 'json')).extra.label).toBe('<script>not HTML</script>');
    expect(formatMetadata(data, 'text')).toContain('NOT CARD VERIFICATION'); expect(formatMetadata(data, 'text')).toContain('Test City');
  });
  it('excludes unexpected account-level values from displayed metadata and exports', () => {
    const data = parseMetadata({ ...guisonFixture(), cvv: '123', card_number: '4242424242424242', nested: { expiry: '12/30', pan: '4242424242424242', note: '4242 4242 4242 4242' } }, '424242');
    const result = formatMetadata(data, 'json'); expect(result).not.toContain('4242424242424242'); expect(result).not.toContain('4242 4242'); expect(result).not.toContain('"cvv"'); expect(result).not.toContain('"expiry"');
  });
  it.each([null, [], {}, { iin: '123456' }, { iin: '4242424242424242' }, { iin: '424242', error: { code: 'bad' } }, { iin: '424242', bank: 'wrong shape' }])('rejects malformed or mismatched responses %#', payload => expect(() => parseMetadata(payload, '424242')).toThrow(/unexpected response/));
  it('treats invalid typed field values as unknown', () => {
    const data = parseMetadata({ iin: '424242', number: { length: '16', luhn: 'false' }, prepaid: 'true' }, '424242');
    expect(data.numberLength).toBeNull(); expect(data.luhn).toBeNull(); expect(data.prepaid).toBeNull();
  });
});
describe('Guison request isolation and errors', () => {
  it('sends only a validated prefix with no credentials, body, or referrer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(guisonFixture('004242'))); vi.stubGlobal('fetch', fetchMock);
    await lookupBin('004242');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${GUISON_ORIGIN}/v1/bin/004242`); expect(init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' }); expect(init.body).toBeUndefined();
  });
  it.each(['12345', '123456789', '4242424242424242', '123456/../../data', '424242?cvv=123', '424242\n'])('never fetches for invalid input %s', async bin => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); await expect(lookupBin(bin)).rejects.toThrow(/6–8/); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([[400, 'invalid_input'], [404, 'not_found'], [429, 'rate_limit'], [500, 'unavailable'], [503, 'unavailable']] as const)('handles HTTP %i without exposing server messages', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { message: 'sensitive server details' } }, status)));
    await expect(lookupBin('424242')).rejects.toMatchObject({ code });
  });
  it('handles network and CORS failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))); await expect(lookupBin('424242')).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('rejects a 200 HTML response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>offline</html>', { headers: { 'Content-Type': 'text/html' } }))); await expect(lookupBin('424242')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('rejects invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{', { headers: { 'Content-Type': 'application/json' } }))); await expect(lookupBin('424242')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('bounds oversized responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...guisonFixture(), extra: 'x'.repeat(70000) }))); await expect(lookupBin('424242')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  function pendingRequest() {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); })));
  }
  it('times out a stalled request and reports local generation remains available', async () => {
    vi.useFakeTimers(); pendingRequest(); const assertion = expect(lookupBin('424242')).rejects.toMatchObject({ code: 'timeout' }); await vi.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS); await assertion;
  });
  it('cancels an in-flight request', async () => {
    pendingRequest(); const controller = new AbortController(); const assertion = expect(lookupBin('424242', controller.signal)).rejects.toMatchObject({ code: 'cancelled' }); controller.abort(); await assertion;
  });
  it('checks readiness without a BIN', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 'ready' })); vi.stubGlobal('fetch', fetchMock); await checkApiStatus(); expect(fetchMock.mock.calls[0][0]).toBe(`${GUISON_ORIGIN}/readyz`);
  });
  it('rejects liveness that is not dataset readiness', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: 'ok' }))); await expect(checkApiStatus()).rejects.toMatchObject({ code: 'unavailable' }); });
});
describe('page-session history', () => {
  it('starts empty, deduplicates, orders newest first and caps at ten', () => {
    const history = new LookupHistory(); expect(history.items).toHaveLength(0);
    for (let i = 0; i < 12; i++) { const bin = String(424240 + i); history.add(parseMetadata(guisonFixture(bin), bin)); }
    expect(history.items).toHaveLength(10); expect(history.items[0].metadata.bin).toBe('424251');
    history.add(parseMetadata(guisonFixture('424245'), '424245')); expect(history.items).toHaveLength(10); expect(history.items[0].metadata.bin).toBe('424245');
  });
  it('clears completely and never shares state between page sessions', () => {
    const first = new LookupHistory(); first.add(parseMetadata(guisonFixture(), '424242')); expect(new LookupHistory().items).toHaveLength(0); first.clear(); expect(first.items).toHaveLength(0);
  });
});
