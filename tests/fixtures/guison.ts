/** Fictional metadata fixture using the documented Guison schema. Never a live response. */
export function guisonFixture(iin = '424242') {
  return {
    iin,
    match: { start: iin.slice(0, 6), end: iin.slice(0, 6), length: 6 },
    number: { length: 16, luhn: true },
    scheme: 'visa', brand: 'QA Test Brand', type: 'debit', level: 'Test product', prepaid: false,
    country: { alpha2: 'DK', alpha3: 'DNK', name: 'Denmark', emoji: '🇩🇰', currency: 'DKK', latitude: 56, longitude: 10 },
    bank: { name: 'Fictional QA Issuer', url: 'https://issuer.invalid', phone: '', city: 'Test City', logo: 'https://issuer.invalid/logo.png' },
  };
}
