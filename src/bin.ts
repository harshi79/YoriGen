/** This message is shared by the Generator's unmasked card-number guard. */
export const COMPLETE_CARD_NUMBER_MESSAGE =
  'Please enter a BIN/IIN prefix or masked synthetic template, not a complete card number.';

/** Validate the entire metadata value: never trim, coerce, truncate, or extract from a PAN. */
export function validateBin(value: string): string {
  if (typeof value !== 'string' || !/^[0-9]{6,8}$/.test(value)) {
    throw new Error('Enter a BIN / IIN of 6–8 digits only. Never enter a complete card number.');
  }
  return value;
}
