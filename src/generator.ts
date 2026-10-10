/**
 * Local synthetic fixture engine.
 *
 * Everything in this module runs in the browser: no network calls, no account
 * lookups, no verification. Numbers are Luhn-compatible because format checks
 * are what test fixtures are for — a valid checksum never means a real card.
 */
import { COMPLETE_CARD_NUMBER_MESSAGE } from "./bin";

export const NETWORKS = [
  "Visa",
  "Mastercard",
  "American Express",
  "Discover",
  "JCB",
  "Diners Club",
  "UnionPay",
  "Maestro",
  "RuPay",
] as const;
export type Network = (typeof NETWORKS)[number];
/**
 * `auto` and `custom` are the modes the fixture builder exposes. The original
 * `random` / `month` / `year` / `fixed` modes are still supported so the
 * low-level generator contract and its tests stay intact.
 */
export type ExpiryMode =
  | "auto"
  | "custom"
  | "random"
  | "month"
  | "year"
  | "fixed";
/** `custom` reads `GeneratorOptions.cvvValue`; `3` / `4` pin an explicit width. */
export type CvvOption = "auto" | "custom" | "3" | "4";
export type OutputFormat = "pipe" | "csv" | "json";
export interface CardRecord {
  number: string;
  month: string;
  year: string;
  cvv: string;
  network: Network;
  synthetic: true;
}
export interface GeneratorOptions {
  /** Numeric visible prefix only; mask characters are parsed before generation. */
  prefix: string;
  /** Full input-template width when the user supplied a masked template. */
  templateLength?: number;
  network: Network | "Random";
  quantity: number;
  expiryMode: ExpiryMode;
  month: number;
  year: number;
  cvv: CvvOption;
  /** Only used when `cvv` is "custom". Synthetic digits that stay in the page. */
  cvvValue?: string;
}
const EXPIRY_MODES: ExpiryMode[] = [
  "auto",
  "custom",
  "random",
  "month",
  "year",
  "fixed",
];
const CVV_OPTIONS: CvvOption[] = ["auto", "custom", "3", "4"];
// Public network-format ranges, not a database of issued cards or accounts.
// Each entry is [low, high, width] for the prefix window, then the accepted
// number lengths and the CVV width. Ranges may overlap between networks (62 is
// shared by Discover and UnionPay, 51–55 by Mastercard and Maestro); that is a
// faithful reflection of the real scheme overlap, and the generator resolves it
// by picking uniformly among the compatible networks.
interface NetworkSpec {
  /** [low, high, width] prefix windows accepted by this network. */
  ranges: [number, number, number][];
  /** Accepted PAN lengths, shortest first. */
  lengths: readonly number[];
  /** Synthetic CVV width: 4 digits for Amex, 3 for every other network. */
  cvv: number;
}
const specs: Record<Network, NetworkSpec> = {
  Visa: { ranges: [[4, 4, 1]], lengths: [16], cvv: 3 },
  Mastercard: {
    ranges: [
      [51, 55, 2],
      [2221, 2720, 4],
    ],
    lengths: [16],
    cvv: 3,
  },
  "American Express": {
    ranges: [
      [34, 34, 2],
      [37, 37, 2],
    ],
    lengths: [15],
    cvv: 4,
  },
  Discover: {
    ranges: [
      [6011, 6011, 4],
      [644, 649, 3],
      [65, 65, 2],
      [622126, 622925, 6],
    ],
    lengths: [16],
    cvv: 3,
  },
  JCB: { ranges: [[3528, 3589, 4]], lengths: [16, 17, 18, 19], cvv: 3 },
  "Diners Club": {
    ranges: [
      [300, 305, 3],
      [3095, 3095, 4],
      [36, 36, 2],
      [38, 39, 2],
    ],
    lengths: [14, 15, 16, 17, 18, 19],
    cvv: 3,
  },
  UnionPay: {
    ranges: [
      [62, 62, 2],
      [81, 81, 2],
    ],
    lengths: [16, 17, 18, 19],
    cvv: 3,
  },
  Maestro: {
    ranges: [
      [5018, 5018, 4],
      [5020, 5020, 4],
      [5038, 5038, 4],
      [56, 69, 2],
      [6759, 6759, 4],
      [6761, 6763, 4],
    ],
    // The scheme allows 12–19; 16–19 is what payment gateways commonly accept.
    lengths: [16, 17, 18, 19],
    cvv: 3,
  },
  RuPay: {
    ranges: [
      [60, 60, 2],
      [65, 65, 2],
      [81, 81, 2],
      [8214, 8220, 4],
    ],
    lengths: [16],
    cvv: 3,
  },
};
/** Short labels for summary lines and badges, where full names are too long. */
const shortNames: Partial<Record<Network, string>> = {
  "American Express": "Amex",
  "Diners Club": "Diners",
};
export function displayName(network: Network): string {
  return shortNames[network] ?? network;
}
/** Accepted synthetic number lengths for a network, shortest first. */
export function cardLengths(network: Network): readonly number[] {
  return specs[network].lengths;
}
/** Human-readable length range, e.g. `16 digits` or `16–19 digits`. */
export function lengthLabel(lengths: readonly number[]): string {
  if (!lengths.length) return "length pending";
  const sorted = [...lengths].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return first === last
    ? `${first} digits`
    : `${first}–${last} digits`;
}
/** Synthetic CVV width: 4 digits for Amex, 3 for every other network. */
export function cvvDigits(network: Network): number {
  return specs[network].cvv;
}
/** Test-format number length: the shortest accepted length for a network. */
export function cardDigits(network: Network): number {
  return specs[network].lengths[0];
}
/** Auto/Custom map onto the original generator modes without changing them. */
export function resolveExpiryMode(mode: ExpiryMode): "random" | "month" | "year" | "fixed" {
  return mode === "auto" ? "random" : mode === "custom" ? "fixed" : mode;
}
export function luhnValid(value: string): boolean {
  if (!/^\d{2,19}$/.test(value)) return false;
  let sum = 0;
  for (
    let i = value.length - 1, double = false;
    i >= 0;
    i--, double = !double
  ) {
    let digit = Number(value[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
export function checkDigit(body: string): string {
  if (!/^\d{1,18}$/.test(body))
    throw new Error("A Luhn body must contain 1–18 digits.");
  for (let digit = 0; digit < 10; digit++)
    if (luhnValid(body + digit)) return String(digit);
  throw new Error("Unable to calculate checksum.");
}
function randomInt(min: number, max: number): number {
  const span = max - min + 1;
  const limit = Math.floor(0x100000000 / span) * span;
  const bytes = new Uint32Array(1);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= limit);
  return min + (bytes[0] % span);
}
function compatibleRanges(
  prefix: string,
  network: Network,
): [number, number, number][] {
  return specs[network].ranges.flatMap(([low, high, width]) => {
    if (!prefix) return [[low, high, width] as [number, number, number]];
    if (prefix.length >= width) {
      const value = Number(prefix.slice(0, width));
      return value >= low && value <= high
        ? [[value, value, width] as [number, number, number]]
        : [];
    }
    const start = Number(prefix.padEnd(width, "0"));
    const end = Number(prefix.padEnd(width, "9"));
    return Math.max(low, start) <= Math.min(high, end)
      ? [
          [Math.max(low, start), Math.min(high, end), width] as [
            number,
            number,
            number,
          ],
        ]
      : [];
  });
}
/** Local network detection for a (partial) prefix — no metadata service needed. */
export function compatibleNetworks(prefix: string): Network[] {
  return NETWORKS.filter(
    (network) => compatibleRanges(prefix, network).length > 0,
  );
}
export function expiryChoices(
  options: GeneratorOptions,
  now = new Date(),
): { month: number; year: number }[] {
  const mode = resolveExpiryMode(options.expiryMode);
  const result = [];
  for (let year = now.getFullYear(); year <= now.getFullYear() + 10; year++) {
    for (let month = 1; month <= 12; month++) {
      if (year === now.getFullYear() && month <= now.getMonth() + 1) continue;
      if (["month", "fixed"].includes(mode) && month !== options.month)
        continue;
      if (["year", "fixed"].includes(mode) && year !== options.year) continue;
      result.push({ month, year });
    }
  }
  return result;
}
/**
 * A custom CVV stays local and must match the width the selected network uses.
 * Mixed auto networks cannot share one custom value, so that is rejected
 * instead of silently narrowing the network choice.
 */
function customCvvValue(value: string | undefined, networks: Network[]): string {
  if (typeof value !== "string" || !/^\d{3,4}$/.test(value))
    throw new Error(
      "A custom CVV must be 3 or 4 digits, using numbers only. Never paste a real CVV.",
    );
  const lengths = [...new Set(networks.map(cvvDigits))];
  if (lengths.length > 1)
    throw new Error(
      "A custom CVV can only match one network length. Choose a specific network, or switch CVV back to Auto.",
    );
  if (lengths[0] !== value.length)
    throw new Error(
      `${displayName(networks[0])} uses a ${lengths[0]}-digit CVV. Enter ${lengths[0]} digits, or switch CVV back to Auto.`,
    );
  return value;
}
export function validateOptions(
  options: GeneratorOptions,
  now = new Date(),
): Network[] {
  if (
    options.templateLength === undefined &&
    /^\d{14,19}$/.test(options.prefix)
  )
    throw new Error(COMPLETE_CARD_NUMBER_MESSAGE);

  const hasMaskedTemplate = options.templateLength !== undefined;
  const validOrdinaryPrefix =
    !hasMaskedTemplate && /^\d{0,8}$/.test(options.prefix);
  const validTemplatePrefix =
    hasMaskedTemplate &&
    /^\d{6,18}$/.test(options.prefix) &&
    Number.isInteger(options.templateLength) &&
    options.templateLength! >= 14 &&
    options.templateLength! <= 19 &&
    options.prefix.length + 1 < options.templateLength!;
  if (!validOrdinaryPrefix && !validTemplatePrefix)
    throw new Error(
      hasMaskedTemplate
        ? "Use a valid masked synthetic template with at least two unspecified positions and a total width of 14–19."
        : "BIN / IIN must contain 1–8 digits, or be blank for an automatic prefix.",
    );

  if (
    !Number.isInteger(options.quantity) ||
    options.quantity < 1 ||
    options.quantity > 100
  )
    throw new Error("Quantity must be a whole number between 1 and 100.");
  if (options.network !== "Random" && !NETWORKS.includes(options.network))
    throw new Error("Choose a supported card network.");

  const compatible =
    options.network === "Random"
      ? compatibleNetworks(options.prefix)
      : [options.network].filter(
          (network) => compatibleRanges(options.prefix, network).length,
        );
  const networks = hasMaskedTemplate
    ? compatible.filter((network) =>
        specs[network].lengths.includes(options.templateLength!),
      )
    : compatible;
  if (!networks.length) {
    if (hasMaskedTemplate && compatible.length)
      throw new Error(
        `A ${options.templateLength}-character masked template is not supported by ${options.network === "Random" ? "any compatible network" : options.network}. Adjust the x count or choose another network.`,
      );
    throw new Error(
      `Prefix ${options.prefix} is not compatible with ${options.network === "Random" ? "a supported network" : options.network}. Choose another prefix or network.`,
    );
  }
  if (!EXPIRY_MODES.includes(options.expiryMode))
    throw new Error("Choose a supported expiry mode.");
  const mode = resolveExpiryMode(options.expiryMode);
  if (!CVV_OPTIONS.includes(options.cvv))
    throw new Error("Choose a supported CVV format.");
  if (options.cvv === "custom") customCvvValue(options.cvvValue, networks);
  else if (
    options.cvv !== "auto" &&
    networks.some((n) => String(cvvDigits(n)) !== options.cvv)
  )
    throw new Error(
      "CVV format does not match the network. Use automatic, or select American Express for 4 digits and another network for 3 digits.",
    );
  if (
    ["month", "fixed"].includes(mode) &&
    (!Number.isInteger(options.month) ||
      options.month < 1 ||
      options.month > 12)
  )
    throw new Error("Select a month between 01 and 12.");
  if (
    ["year", "fixed"].includes(mode) &&
    (!Number.isInteger(options.year) ||
      options.year < now.getFullYear() ||
      options.year > now.getFullYear() + 10)
  )
    throw new Error("Select a year within the next 10 years.");
  if (!expiryChoices(options, now).length)
    throw new Error(
      "Expiry must be after the current month. Choose a future month or year.",
    );
  return networks;
}
export function generateCards(
  options: GeneratorOptions,
  now = new Date(),
): CardRecord[] {
  const networks = validateOptions(options, now);
  const dates = expiryChoices(options, now);
  return Array.from({ length: options.quantity }, () => {
    const network = networks[randomInt(0, networks.length - 1)];
    const possible = compatibleRanges(options.prefix, network);
    const [low, high, width] = possible[randomInt(0, possible.length - 1)];
    let body =
      options.prefix.length >= width
        ? options.prefix
        : String(randomInt(low, high)).padStart(width, "0");
    const lengths = specs[network].lengths;
    // A long explicit prefix can outrun a short variant: Diners accepts 14
    // digits, so an 8-digit prefix leaves no room for a check digit. In that
    // case fall back to the shortest length that fits rather than truncating
    // the prefix; otherwise keep the full range of accepted lengths.
    const required = options.prefix.length + 1;
    const length =
      options.templateLength ??
      (required > cardDigits(network)
        ? lengths.find((candidate) => candidate >= required) ??
          lengths[lengths.length - 1]
        : lengths[randomInt(0, lengths.length - 1)]);
    while (body.length < length - 1) body += randomInt(0, 9);
    const expiry = dates[randomInt(0, dates.length - 1)];
    const digits = cvvDigits(network);
    return {
      number: body + checkDigit(body),
      month: String(expiry.month).padStart(2, "0"),
      year: String(expiry.year).slice(-2),
      cvv:
        options.cvv === "custom"
          ? options.cvvValue!
          : String(randomInt(0, 10 ** digits - 1)).padStart(digits, "0"),
      network,
      synthetic: true,
    };
  });
}
export function formatRecords(
  records: CardRecord[],
  format: OutputFormat,
): string {
  if (format === "json") return JSON.stringify(records, null, 2);
  return records
    .map((r) =>
      format === "csv"
        ? `${r.number},${r.month},${r.year},${r.cvv}`
        : `${r.number} | ${r.month}/${r.year} | ${r.cvv}`,
    )
    .join("\n");
}
export function displayNumber(record: CardRecord): string {
  if (record.network === "American Express")
    // Classic 4-6-5 grouping for the 15-digit Amex shape.
    return `${record.number.slice(0, 4)} ${record.number.slice(4, 10)} ${record.number.slice(10)}`;
  if (record.network === "Diners Club" && record.number.length === 14)
    // Classic 4-6-4 grouping for the 14-digit Diners shape.
    return `${record.number.slice(0, 4)} ${record.number.slice(4, 10)} ${record.number.slice(10)}`;
  return record.number.match(/.{1,4}/g)!.join(" ");
}
