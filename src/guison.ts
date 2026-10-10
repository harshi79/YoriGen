import { validateBin } from './bin';
export const GUISON_ORIGIN = 'https://guison-api.onrender.com';
export const LOOKUP_TIMEOUT_MS = 15000;
const MAX_RESPONSE_CHARS = 65536;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export interface BinMetadata {
  bin: string;
  scheme: string | null;
  brand: string | null;
  type: string | null;
  product: string | null;
  issuer: string | null;
  country: string | null;
  flag: string | null;
  currency: string | null;
  numberLength: number | null;
  luhn: boolean | null;
  prepaid: boolean | null;
  raw: JsonObject;
}
export type LookupErrorCode = 'not_found' | 'invalid_input' | 'rate_limit' | 'unavailable' | 'invalid_response' | 'timeout' | 'cancelled';
export class LookupError extends Error {
  constructor(public readonly code: LookupErrorCode, message: string) { super(message); this.name = 'LookupError'; }
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
const boolean = (value: unknown) => typeof value === 'boolean' ? value : null;
const malformed = () => new LookupError('invalid_response', 'Guison returned an unexpected response. Try again later; local generation is unaffected.');
// Keep response data inert. Never render HTML, follow returned URLs, or fetch issuer logos.
// Unexpected account-level fields are intentionally excluded from display and exports.
const sensitiveKeys = /^(pan|card_?number|account_?number|cvv|cvc|security_?code|expir(y|ation)|expir(y|ation)_?date)$/i;
function safeJson(value: unknown, depth = 0): Json {
  if (depth > 8) throw malformed();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value.replace(/\b(?:\d[ -]?){11,18}\d\b/g, '[redacted numeric value]');
  if (Array.isArray(value)) return value.map(item => safeJson(item, depth + 1));
  const record = object(value);
  if (!record) throw malformed();
  return Object.fromEntries(Object.entries(record).filter(([key]) => !sensitiveKeys.test(key)).map(([key, val]) => [key, safeJson(val, depth + 1)]));
}
export function parseMetadata(value: unknown, requestedBin: string): BinMetadata {
  validateBin(requestedBin);
  const source = object(value);
  if (!source || source.error || source.iin !== requestedBin) throw malformed();
  const raw = safeJson(source) as JsonObject;
  const number = object(raw.number);
  const country = object(raw.country);
  const bank = object(raw.bank);
  // The documented schema requires objects for these fields; optional objects may be absent.
  for (const key of ['number', 'country', 'bank', 'match']) {
    if (source[key] !== undefined && source[key] !== null && !object(source[key])) throw malformed();
  }
  return {
    bin: requestedBin, scheme: text(raw.scheme), brand: text(raw.brand), type: text(raw.type),
    product: text(raw.level) ?? text(raw.product), issuer: text(bank?.name),
    country: text(country?.name), flag: text(country?.emoji) ?? flagFromCode(text(country?.alpha2)),
    currency: text(country?.currency),
    numberLength: typeof number?.length === 'number' && Number.isInteger(number.length) && number.length >= 12 && number.length <= 19 ? number.length : null,
    luhn: boolean(number?.luhn), prepaid: boolean(raw.prepaid), raw,
  };
}
function flagFromCode(code: string | null): string | null {
  return code && /^[A-Z]{2}$/.test(code) ? Array.from(code, char => String.fromCodePoint(127397 + char.charCodeAt(0))).join('') : null;
}
async function request(path: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(`${GUISON_ORIGIN}${path}`, {
      method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 404) throw new LookupError('not_found', 'No metadata was found for this BIN / IIN. This says nothing about a card or account.');
      if (response.status === 400) throw new LookupError('invalid_input', 'Guison rejected this prefix. Use exactly 6–8 digits.');
      if (response.status === 429) throw new LookupError('rate_limit', 'Guison is rate limiting requests. Wait a moment before trying again.');
      throw new LookupError('unavailable', 'Guison is unavailable or not ready. Try again later. Your local generator still works.');
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw malformed();
    // Bound even chunked responses; do not accumulate an unbounded response body.
    const reader = response.body?.getReader();
    if (!reader) throw malformed();
    const decoder = new TextDecoder();
    let body = '', bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_CHARS) { await reader.cancel(); throw malformed(); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    try { return JSON.parse(body); } catch { throw malformed(); }
  } catch (error) {
    if (timedOut) throw new LookupError('timeout', 'Guison took too long to respond. It may be waking up. Try again; local generation is available.');
    if (signal?.aborted) throw new LookupError('cancelled', 'Lookup cancelled.');
    if (error instanceof LookupError) throw error;
    throw new LookupError('unavailable', 'Could not reach Guison. Check your connection or try later. Local generation is unaffected.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function lookupBin(bin: string, signal?: AbortSignal): Promise<BinMetadata> {
  validateBin(bin); // Must run before constructing a URL or making any request.
  return parseMetadata(await request(`/v1/bin/${bin}`, signal), bin);
}
export async function checkApiStatus(signal?: AbortSignal): Promise<void> {
  const value = object(await request('/readyz', signal));
  if (value?.status !== 'ready') throw new LookupError('unavailable', 'Guison is reachable but its metadata dataset is not ready.');
}
export function metadataEntries(data: BinMetadata): [string, string][] {
  const display = (value: string | number | boolean | null) => value === null ? 'Unknown' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  return [
    ['BIN / IIN', data.bin], ['Scheme / network', display(data.scheme)], ['Brand', display(data.brand)],
    ['Card type', display(data.type)], ['Product / level', display(data.product)], ['Issuer', display(data.issuer)],
    ['Country', data.country ? `${data.flag ? `${data.flag} ` : ''}${data.country}` : 'Unknown'],
    ['Currency', display(data.currency)], ['Number length', display(data.numberLength)],
    ['Luhn compatibility', display(data.luhn)], ['Prepaid', display(data.prepaid)],
  ];
}
export function formatMetadata(data: BinMetadata, format: 'text' | 'json'): string {
  if (format === 'json') return JSON.stringify(data.raw, null, 2);
  return ['BIN / IIN METADATA ONLY — NOT CARD VERIFICATION', ...metadataEntries(data).map(([key, value]) => `${key}: ${value}`), '', 'Additional response metadata:', JSON.stringify(data.raw, null, 2), '', 'Source: Guison · venelinkochev/bin-list-data (CC BY 4.0)'].join('\n');
}
export interface HistoryEntry { metadata: BinMetadata; lookedUpAt: string }
/** Page-memory only: never written to localStorage, sessionStorage, a URL, or a server. */
export class LookupHistory {
  private entries: HistoryEntry[] = [];
  get items(): readonly HistoryEntry[] { return this.entries; }
  add(metadata: BinMetadata, date = new Date()): void {
    this.entries = [{ metadata, lookedUpAt: date.toISOString() }, ...this.entries.filter(item => item.metadata.bin !== metadata.bin)].slice(0, 10);
  }
  clear(): void { this.entries = []; }
}
