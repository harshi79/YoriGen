/**
 * Fixture-builder form contract.
 *
 * This layer translates the five builder steps (BIN, expiry, CVV, quantity,
 * generate) into the low-level generator options and produces friendly,
 * field-scoped validation messages. Nothing here ever leaves the page.
 */
import { COMPLETE_CARD_NUMBER_MESSAGE, validateBin } from "./bin";
import {
  cardLengths,
  compatibleNetworks,
  cvvDigits,
  displayName,
  lengthLabel,
  resolveExpiryMode,
  type GeneratorOptions,
  type Network,
} from "./generator";

export interface ParsedGeneratorInput {
  /** The safe 6–8 digit value accepted by the existing BIN metadata boundary. */
  metadataPrefix: string;
  /** Every user-visible digit, retained as the local synthetic generator prefix. */
  generatorPrefix: string;
  /** Full template width, including x positions; absent for an ordinary BIN/IIN. */
  templateLength?: number;
}

const INVALID_GENERATOR_INPUT_MESSAGE =
  "Enter a synthetic BIN / IIN prefix of 6–8 digits, or a valid masked template with visible digits followed by x characters.";
const INVALID_MASKED_TEMPLATE_MESSAGE =
  "Enter a valid 14–19 character masked template: at least 6 visible digits followed by at least two x characters.";

/**
 * Split a manual Generator value into its independent metadata and generation
 * inputs. Mask characters are only placeholders: they are never converted to
 * digits or sent through the metadata boundary.
 */
export function parseGeneratorInput(value: string): ParsedGeneratorInput {
  if (value === "")
    return { metadataPrefix: "", generatorPrefix: "" };

  if (/^\d+$/.test(value)) {
    if (/^\d{14,19}$/.test(value))
      throw new Error(COMPLETE_CARD_NUMBER_MESSAGE);
    if (/^\d{6,8}$/.test(value)) {
      validateBin(value);
      return {
        metadataPrefix: value,
        generatorPrefix: value,
      };
    }
    throw new Error(INVALID_GENERATOR_INPUT_MESSAGE);
  }

  const masked = /^(\d+)(x+)$/i.exec(value);
  if (!masked) {
    throw new Error(
      /x/i.test(value)
        ? INVALID_MASKED_TEMPLATE_MESSAGE
        : INVALID_GENERATOR_INPUT_MESSAGE,
    );
  }

  const [, visibleDigits, masks] = masked;
  const templateLength = visibleDigits.length + masks.length;
  if (
    visibleDigits.length < 6 ||
    masks.length < 2 ||
    templateLength < 14 ||
    templateLength > 19
  )
    throw new Error(INVALID_MASKED_TEMPLATE_MESSAGE);

  const metadataPrefix = visibleDigits.slice(0, 8);
  validateBin(metadataPrefix);
  return {
    metadataPrefix,
    generatorPrefix: visibleDigits,
    templateLength,
  };
}

/** Only this derived value may be passed to the existing metadata service. */
export function metadataLookupPrefix(value: string): string {
  const prefix = parseGeneratorInput(value).metadataPrefix;
  if (!prefix) throw new Error(INVALID_GENERATOR_INPUT_MESSAGE);
  return prefix;
}

export type GeneratorInput = Omit<GeneratorOptions, "network"> & {
  network: GeneratorOptions["network"] | "Auto";
};
/** Auto is the builder-facing alias for "use the existing generator rules". */
export function prepareGeneratorOptions(input: GeneratorInput): GeneratorOptions {
  const parsed = parseGeneratorInput(input.prefix);
  return {
    ...input,
    prefix: parsed.generatorPrefix,
    templateLength: parsed.templateLength,
    network: input.network === "Auto" ? "Random" : input.network,
    cvvValue: input.cvv === "custom" ? input.cvvValue : undefined,
  };
}
export type BinMode = "auto" | "manual";
export type ValueMode = "auto" | "custom";
/** Exactly what the five builder steps hold right now. */
export interface GeneratorFormValues {
  binMode: BinMode;
  prefix: string;
  network: GeneratorOptions["network"] | "Auto";
  expiryMode: ValueMode;
  month: number;
  year: number;
  cvvMode: ValueMode;
  cvvValue: string;
  quantity: number;
}
export interface GeneratorFieldErrors {
  prefix?: string;
  network?: string;
  expiry?: string;
  cvv?: string;
  quantity?: string;
}
export function hasFieldErrors(errors: GeneratorFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
/** The numeric prefix used for generation; Auto never reads typed digits. */
export function effectivePrefix(
  values: Pick<GeneratorFormValues, "binMode" | "prefix">,
): string {
  if (values.binMode === "auto") return "";
  try {
    return parseGeneratorInput(values.prefix).generatorPrefix;
  } catch {
    // Keep typing/editing paths non-throwing; validation blocks malformed input.
    return values.prefix;
  }
}
function parsedManualInput(
  values: Pick<GeneratorFormValues, "binMode" | "prefix">,
): ParsedGeneratorInput | undefined {
  if (values.binMode === "auto" || values.prefix === "") return undefined;
  try {
    return parseGeneratorInput(values.prefix);
  } catch {
    return undefined;
  }
}
/** Networks compatible with the current BIN and, for templates, their width. */
export function formNetworks(values: GeneratorFormValues): Network[] {
  const prefix = effectivePrefix(values);
  const parsed = parsedManualInput(values);
  if (values.binMode === "manual" && values.prefix && !parsed) return [];
  const compatible = compatibleNetworks(prefix).filter(
    (network) =>
      parsed?.templateLength === undefined ||
      cardLengths(network).includes(parsed.templateLength),
  );
  if (values.network === "Auto" || values.network === "Random")
    return compatible;
  return compatible.includes(values.network) ? [values.network] : [];
}
function expiryError(
  values: GeneratorFormValues,
  now: Date,
): string | undefined {
  if (values.expiryMode === "auto") return undefined;
  const lastYear = now.getFullYear() + 10;
  if (!Number.isInteger(values.month) || values.month < 1 || values.month > 12)
    return "Choose a month between 01 and 12.";
  if (
    !Number.isInteger(values.year) ||
    values.year < now.getFullYear() ||
    values.year > lastYear
  )
    return `Choose a year between ${now.getFullYear()} and ${lastYear}.`;
  if (values.year * 12 + values.month <= now.getFullYear() * 12 + now.getMonth() + 1)
    return "Choose an expiry month after the current month.";
  return undefined;
}
function cvvError(
  values: GeneratorFormValues,
  networks: Network[],
): string | undefined {
  if (values.cvvMode === "auto") return undefined;
  if (!/^\d{3,4}$/.test(values.cvvValue))
    return "Enter 3 or 4 digits only. Use synthetic numbers, never a real CVV.";
  if (!networks.length) return undefined;
  const widths = [...new Set(networks.map(cvvDigits))];
  if (widths.length > 1)
    return `A custom CVV cannot cover ${networks.map(displayName).join(", ")} at once. Pick one network, or switch CVV back to Auto.`;
  if (widths[0] !== values.cvvValue.length)
    return `${displayName(networks[0])} uses a ${widths[0]}-digit CVV. Enter ${widths[0]} digits, or switch CVV back to Auto.`;
  return undefined;
}
/** Field-scoped validation. Every message suggests how to fix the input. */
export function validateGeneratorForm(
  values: GeneratorFormValues,
  now = new Date(),
): GeneratorFieldErrors {
  const errors: GeneratorFieldErrors = {};
  const prefix = effectivePrefix(values);
  const parsed = parsedManualInput(values);
  if (values.binMode === "manual") {
    if (prefix === "")
      errors.prefix =
        "Enter a 6–8 digit synthetic BIN / IIN prefix or masked template, or turn on Auto.";
    else {
      try {
        parseGeneratorInput(values.prefix);
      } catch (error) {
        errors.prefix = (error as Error).message;
      }
    }
  }
  const networks = errors.prefix ? [] : formNetworks(values);
  if (!errors.prefix && !networks.length) {
    const compatible = compatibleNetworks(prefix);
    const lengthCompatible = parsed?.templateLength
      ? compatible.filter((network) =>
          cardLengths(network).includes(parsed.templateLength!),
        )
      : compatible;
    if (parsed?.templateLength && compatible.length && !lengthCompatible.length) {
      errors.network =
        values.network === "Auto" || values.network === "Random"
          ? `No supported test network accepts this ${parsed.templateLength}-character masked template. Adjust the x count.`
          : `${displayName(values.network)} does not accept a ${parsed.templateLength}-character masked template. Adjust the x count.`;
    } else {
      errors.network =
        values.network === "Auto" || values.network === "Random"
          ? "No supported test network matches this BIN. Check the digits, or turn on Auto."
          : compatible.length
            ? `${displayName(values.network)} does not match this BIN. Compatible here: ${compatible.map(displayName).join(", ")}.`
            : `${displayName(values.network)} does not match this BIN, and no supported network does. Check the digits, or turn on Auto.`;
    }
  }
  const expiry = expiryError(values, now);
  if (expiry) errors.expiry = expiry;
  const cvv = cvvError(values, networks);
  if (cvv) errors.cvv = cvv;
  if (
    !Number.isInteger(values.quantity) ||
    values.quantity < 1 ||
    values.quantity > 100
  )
    errors.quantity = "Choose a whole number of fixtures between 1 and 100.";
  return errors;
}
/**
 * One-line preview of what the next generation run will produce, e.g.
 * `Visa · 16 digits · Auto expiry · Auto CVV · 10 fixtures`.
 */
export function summarizeGeneratorForm(values: GeneratorFormValues): string {
  const networks = formNetworks(values);
  const names = networks.map(displayName);
  const networkLabel =
    names.length === 1
      ? names[0]
      : names.length
        ? "Auto network"
        : "Network pending";
  const widths = [
    ...new Set(networks.flatMap((network) => [...cardLengths(network)])),
  ];
  const lengthLabelText = lengthLabel(widths);
  const mode = resolveExpiryMode(values.expiryMode);
  const expiryLabel =
    mode === "random"
      ? "Auto expiry"
      : mode === "month"
        ? `Expiry ${String(values.month).padStart(2, "0")}`
        : mode === "year"
          ? `Expiry ${values.year}`
          : `Expiry ${String(values.month).padStart(2, "0")}/${String(values.year).slice(-2)}`;
  const cvvLabel =
    values.cvvMode === "custom"
      ? `Custom CVV (${values.cvvValue.length} digits)`
      : "Auto CVV";
  const quantity =
    Number.isInteger(values.quantity) && values.quantity > 0
      ? values.quantity
      : 0;
  return [
    networkLabel,
    lengthLabelText,
    expiryLabel,
    cvvLabel,
    `${quantity} ${quantity === 1 ? "fixture" : "fixtures"}`,
  ].join(" · ");
}
