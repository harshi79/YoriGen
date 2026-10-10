import { describe, expect, it } from 'vitest';
import { validateBin } from './bin';
import { prepareGeneratorOptions } from './generator-input';
import { generateCards, type GeneratorOptions } from './generator';
const base: GeneratorOptions = { prefix: '', network: 'Random', quantity: 10, expiryMode: 'random', month: 1, year: 2027, cvv: 'auto' };
describe('strict UI and API BIN boundary', () => {
  it.each(['123456', '1234567', '12345678', '000042'])('preserves a valid prefix %s', prefix => expect(validateBin(prefix)).toBe(prefix));
  it.each(['', '4', '12345', '123456789', '4242424242424242', '4242 4242 4242 4242', ' 424242', '424242 ', '424-242', '１２３４５６', '12345a', '123456\n', '4e1234', 'https://x.invalid', '123456?cvv=123'])('rejects entire malformed input without truncation: %s', prefix => expect(() => validateBin(prefix)).toThrow(/6–8 digits/));
  it('rejects numbers instead of strings', () => expect(() => validateBin(123456 as unknown as string)).toThrow());
  it('allows an empty prefix for local Auto generation', () => expect(generateCards(prepareGeneratorOptions({ ...base, network: 'Auto' }))).toHaveLength(10));
  it('Auto detects a network locally from a valid prefix', () => expect(generateCards(prepareGeneratorOptions({ ...base, prefix: '371234', network: 'Auto' })).every(r => r.network === 'American Express')).toBe(true));
  it('keeps Random and explicit selections unchanged', () => {
    expect(prepareGeneratorOptions({ ...base, prefix: '424242', network: 'Random' }).network).toBe('Random');
    expect(prepareGeneratorOptions({ ...base, prefix: '424242', network: 'Visa' }).network).toBe('Visa');
  });
  it('rejects short prefixes at the UI boundary but retains lower-level generator capability', () => {
    expect(() => prepareGeneratorOptions({ ...base, prefix: '4' })).toThrow();
    expect(generateCards({ ...base, prefix: '4' })).toHaveLength(10);
  });
  it('does not hide incompatible BIN/network requests', () => expect(() => generateCards(prepareGeneratorOptions({ ...base, prefix: '424242', network: 'American Express' }))).toThrow(/not compatible/));
});
