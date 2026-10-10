import { afterEach, describe, expect, it, vi } from "vitest";
import {
  effectivePrefix,
  formNetworks,
  hasFieldErrors,
  metadataLookupPrefix,
  parseGeneratorInput,
  prepareGeneratorOptions,
  summarizeGeneratorForm,
  validateGeneratorForm,
  type GeneratorFormValues,
} from "./generator-input";
import { generateCards, luhnValid } from "./generator";
import { GUISON_ORIGIN, lookupBin } from "./guison";
import { guisonFixture } from "../tests/fixtures/guison";

afterEach(() => vi.unstubAllGlobals());

const now = new Date(2026, 8, 29);
const Y = now.getFullYear();
const form: GeneratorFormValues = {
  binMode: "manual",
  prefix: "424242",
  network: "Auto",
  expiryMode: "auto",
  month: 7,
  year: Y + 1,
  cvvMode: "auto",
  cvvValue: "",
  quantity: 10,
};
const values = (overrides: Partial<GeneratorFormValues> = {}): GeneratorFormValues => ({
  ...form,
  ...overrides,
});
const validate = (overrides: Partial<GeneratorFormValues> = {}) =>
  validateGeneratorForm(values(overrides), now);
const generate = (
  overrides: Partial<GeneratorFormValues> = {},
  quantity = values(overrides).quantity,
) =>
  generateCards(
    prepareGeneratorOptions({
      prefix:
        values(overrides).binMode === "auto" ? "" : values(overrides).prefix,
      network: values(overrides).network,
      quantity,
      expiryMode: values(overrides).expiryMode,
      month: values(overrides).month,
      year: values(overrides).year,
      cvv: values(overrides).cvvMode === "custom" ? "custom" : "auto",
      cvvValue: values(overrides).cvvValue,
    }),
    now,
  );

describe("step 1 · BIN / IIN validation", () => {
  it.each(["424242", "4242424", "42424242", "555555", "378282", "601111"])(
    "accepts a 6–8 digit synthetic prefix: %s",
    (prefix) => expect(validate({ prefix })).toEqual({}),
  );
  it.each([
    ["", "Enter a 6–8 digit"],
    ["4242", "6–8 digits"],
    ["4242424 2", "6–8 digits"],
    ["abc", "6–8 digits"],
    ["4e1234", "6–8 digits"],
    ["4242-42", "6–8 digits"],
    ["１２３４５６", "6–8 digits"],
  ])("reports an invalid BIN for %j with a friendly message", (prefix, message) => {
    expect(validate({ prefix }).prefix).toContain(message);
  });
  it("never truncates or extracts digits from a longer value", () => {
    const prefix = "4242424242424242";
    expect(validate({ prefix }).prefix).toBeTruthy();
    expect(() => generate({ prefix })).toThrow();
  });
  it.each([14, 15, 16, 17, 19])(
    "rejects a complete unmasked %s-digit card-like value with the explicit message",
    (length) => {
      const value = "4".repeat(length);
      expect(validate({ prefix: value }).prefix).toBe(
        "Please enter a BIN/IIN prefix or masked synthetic template, not a complete card number.",
      );
      expect(() => parseGeneratorInput(value)).toThrow(
        "Please enter a BIN/IIN prefix or masked synthetic template, not a complete card number.",
      );
    },
  );
  it("allows an empty BIN when Auto mode is on", () => {
    expect(validate({ binMode: "auto", prefix: "" })).toEqual({});
    expect(effectivePrefix({ binMode: "auto", prefix: "424242" })).toBe("");
  });
  it("ignores typed digits while Auto mode is on", () => {
    expect(generate({ binMode: "auto", prefix: "4" }, 20).length).toBe(20);
  });
});

describe("masked synthetic templates", () => {
  it.each([
    ["424242xxxxxxxxxx", "424242", "424242"],
    ["42424242xxxxxxxx", "42424242", "42424242"],
    ["5279109907xxxxxx", "5279109907", "52791099"],
  ])(
    "splits %s into a metadata prefix and the full generator prefix",
    (template, generatorPrefix, metadataPrefix) => {
      expect(parseGeneratorInput(template)).toMatchObject({
        generatorPrefix,
        metadataPrefix,
        templateLength: 16,
      });
      expect(metadataLookupPrefix(template)).toBe(metadataPrefix);
      expect(effectivePrefix(values({ prefix: template }))).toBe(generatorPrefix);
      expect(validate({ prefix: template })).toEqual({});

      const rows = generate({ prefix: template, network: "Auto" }, 10);
      expect(rows).toHaveLength(10);
      expect(
        rows.every(
          (row) =>
            row.number.startsWith(generatorPrefix) &&
            row.number.length === 16 &&
            /^\d+$/.test(row.number) &&
            luhnValid(row.number),
        ),
      ).toBe(true);
      expect(rows.every((row) => !row.number.includes("x"))).toBe(true);
    },
  );

  it.each(["424242xxxxxxxxxx", "424242XXXXXXXXXX", "424242xxxxXXXXXX"])(
    "accepts lower- and uppercase x mask characters in %s",
    (template) => {
      expect(parseGeneratorInput(template).templateLength).toBe(16);
      expect(generate({ prefix: template }, 2).every((row) => row.number.length === 16)).toBe(
        true,
      );
    },
  );

  it("does not create a metadata prefix for empty input", () => {
    expect(() => metadataLookupPrefix("")).toThrow(/6–8 digits/);
  });

  it("reports a masked template width unsupported by the detected network", () => {
    const template = "424242xxxxxxxx";
    expect(validate({ prefix: template }).network).toContain(
      "No supported test network accepts this 14-character masked template",
    );
    expect(validate({ prefix: template, network: "Visa" }).network).toContain(
      "Visa does not accept a 14-character masked template",
    );
  });

  it("reports missing network matches and avoids a CVV error for malformed BIN input", () => {
    const template = "999999xxxxxxxxxx";
    expect(validate({ prefix: template }).network).toContain(
      "No supported test network matches this BIN",
    );
    expect(validate({ prefix: template, network: "Visa" }).network).toContain(
      "no supported network does",
    );
    expect(formNetworks(values({ prefix: "malformed" }))).toEqual([]);
    expect(
      validate({ prefix: "malformed", cvvMode: "custom", cvvValue: "123" }).cvv,
    ).toBeUndefined();
  });

  it.each([
    ["424242xxxxxxxxxx", "424242"],
    ["42424242xxxxxxxx", "42424242"],
    ["5279109907xxxxxx", "52791099"],
  ])("sends only the safe metadata prefix for %s", async (template, metadataPrefix) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(guisonFixture(metadataPrefix)), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await lookupBin(metadataLookupPrefix(template));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${GUISON_ORIGIN}/v1/bin/${metadataPrefix}`,
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain(template);
    expect(String(fetchMock.mock.calls[0][0])).not.toMatch(/[xX]/);
  });

  it.each([
    "424242xx123456",
    "424242xxxxxx1234",
    "424242 2xxxxxxx",
    "xxxxxx",
    "424242xxxxx",
    "42424242424242x",
    `424242${"x".repeat(20)}`,
  ])("rejects malformed masked template %j", (template) => {
    expect(() => parseGeneratorInput(template)).toThrow();
    expect(validate({ prefix: template }).prefix).toBeTruthy();
    expect(() => generate({ prefix: template })).toThrow();
  });
});

describe("unsupported prefix / network combinations", () => {
  it("flags a prefix no supported network covers", () => {
    expect(validate({ prefix: "999999" }).network).toContain("No supported test network");
  });
  it("names the compatible networks when the chosen one does not match", () => {
    expect(validate({ prefix: "424242", network: "American Express" }).network).toContain(
      "Compatible here: Visa",
    );
  });
  it("accepts supported combinations", () => {
    expect(validate({ prefix: "371234", network: "American Express" })).toEqual({});
    expect(validate({ prefix: "222100", network: "Mastercard" })).toEqual({});
    expect(validate({ prefix: "601100", network: "Discover" })).toEqual({});
  });
  it("reports BIN and network separately, never both at once", () => {
    const errors = validate({ prefix: "4242", network: "Mastercard" });
    expect(errors.prefix).toBeTruthy();
    expect(errors.network).toBeUndefined();
  });
  it("exposes the compatible networks for the summary and the CVV rule", () => {
    expect(formNetworks(values({ prefix: "371234", network: "Auto" }))).toEqual([
      "American Express",
    ]);
    expect(formNetworks(values({ prefix: "371234", network: "Visa" }))).toEqual([]);
  });
  it("requires a real BIN match before generating", () => {
    expect(() => generate({ prefix: "999999" })).toThrow(/not compatible/);
  });
});

describe("step 2 · Auto expiry", () => {
  it("builds synthetic future expiry values locally", () => {
    for (const row of generate({ expiryMode: "auto" }, 100)) {
      const expiry = 2000 + Number(row.year);
      const months = expiry * 12 + Number(row.month);
      expect(months).toBeGreaterThan(Y * 12 + now.getMonth() + 1);
      expect(Number(row.month)).toBeGreaterThanOrEqual(1);
      expect(Number(row.month)).toBeLessThanOrEqual(12);
    }
  });
  it("is the default and needs no month or year", () =>
    expect(validate({ expiryMode: "auto", month: 0, year: 0 })).toEqual({}));
  it("keeps the existing Luhn/test-format logic", () => {
    for (const row of generate({ expiryMode: "auto" }, 25))
      expect(luhnValid(row.number)).toBe(true);
  });
});

describe("step 2 · Custom expiry", () => {
  it("uses the selected synthetic month and year on every fixture", () => {
    const rows = generate({ expiryMode: "custom", month: 11, year: Y + 2 }, 20);
    expect(rows.every((row) => row.month === "11" && row.year === String(Y + 2).slice(-2))).toBe(
      true,
    );
  });
  it("accepts the current month of a later year", () =>
    expect(validate({ expiryMode: "custom", month: 9, year: Y + 1 })).toEqual({}));
  it("accepts next month of the current year", () =>
    expect(validate({ expiryMode: "custom", month: 10, year: Y })).toEqual({}));
  it("rejects a month that already passed", () =>
    expect(validate({ expiryMode: "custom", month: 8, year: Y }).expiry).toContain(
      "after the current month",
    ));
  it("rejects the current month in the current year", () =>
    expect(validate({ expiryMode: "custom", month: 9, year: Y }).expiry).toBeTruthy());
  it.each([0, 13, 1.5, NaN])("rejects out-of-range month %s", (month) =>
    expect(validate({ expiryMode: "custom", month }).expiry).toContain("month between 01 and 12"),
  );
  it.each([Y - 1, Y + 11, NaN, 2027.5])("rejects out-of-range year %s", (year) =>
    expect(validate({ expiryMode: "custom", year }).expiry).toContain("Choose a year between"),
  );
  it("blocks generation instead of producing unexpected output", () =>
    expect(() => generate({ expiryMode: "custom", month: 1, year: Y })).toThrow());
});

describe("step 3 · Auto CVV", () => {
  it("matches the network width: 4 for Amex, 3 for the rest", () => {
    for (const row of generate({ prefix: "371234", network: "American Express" }, 20))
      expect(row.cvv).toMatch(/^\d{4}$/);
    for (const row of generate({ prefix: "424242", network: "Visa" }, 20))
      expect(row.cvv).toMatch(/^\d{3}$/);
  });
  it("is the default and requires no custom value", () =>
    expect(validate({ cvvMode: "auto", cvvValue: "!!" })).toEqual({}));
});

describe("step 3 · Custom CVV", () => {
  it("accepts a 3-digit value for Visa and uses it verbatim", () =>
    expect(
      generate({ prefix: "424242", network: "Visa", cvvMode: "custom", cvvValue: "042" }, 15).every(
        (row) => row.cvv === "042",
      ),
    ).toBe(true));
  it("accepts a 4-digit value for Amex", () =>
    expect(
      generate(
        { prefix: "371234", network: "American Express", cvvMode: "custom", cvvValue: "0000" },
        5,
      ).every((row) => row.cvv === "0000"),
    ).toBe(true));
  it("lets Auto detect a single network and apply the matching custom length", () =>
    expect(validate({ prefix: "371234", network: "Auto", cvvMode: "custom", cvvValue: "1234" })).toEqual(
      {},
    ));
  it("rejects a 4-digit custom CVV for a 3-digit network", () =>
    expect(
      validate({ prefix: "424242", network: "Visa", cvvMode: "custom", cvvValue: "1234" }).cvv,
    ).toContain("Visa uses a 3-digit CVV"));
  it("rejects a 3-digit custom CVV for Amex", () =>
    expect(
      validate({
        prefix: "371234",
        network: "American Express",
        cvvMode: "custom",
        cvvValue: "123",
      }).cvv,
    ).toContain("4-digit CVV"));
  it.each(["", "12", "12345", "abc", "12a", " 123", "123 ", "１２３"])(
    "rejects malformed custom CVV %j",
    (cvvValue) =>
      expect(validate({ cvvMode: "custom", cvvValue }).cvv).toBeTruthy(),
  );
  it("rejects a custom CVV for a mixed auto network instead of narrowing the network", () =>
    expect(
      validate({
        binMode: "auto",
        prefix: "",
        network: "Auto",
        cvvMode: "custom",
        cvvValue: "123",
      }).cvv,
    ).toContain("cannot cover"));
  it("fails generation rather than silently ignoring the custom value", () =>
    expect(() => generate({ network: "Visa", cvvMode: "custom", cvvValue: "1234" })).toThrow(
      /3-digit CVV/,
    ));
  it("treats every custom CVV as synthetic and never trims it", () => {
    expect(() => generate({ network: "Visa", cvvMode: "custom", cvvValue: " 123" })).toThrow();
  });
});

describe("step 4 · Quantity", () => {
  it.each([1, 5, 10, 25, 50, 100])("accepts preset quantity %s", (quantity) =>
    expect(validate({ quantity })).toEqual({},
  ));
  it.each([0, -5, 101, 1000, 1.5, NaN])("rejects quantity %s", (quantity) =>
    expect(validate({ quantity }).quantity).toContain("between 1 and 100"),
  );
  it("generates exactly the requested number of fixtures", () => {
    expect(generate({}, 1)).toHaveLength(1);
    expect(generate({}, 100)).toHaveLength(100);
  });
  it("blocks generation for an invalid quantity", () =>
    expect(() => generate({ quantity: 101 })).toThrow(/between 1 and 100/));
});

describe("step 5 · generated fixture summary", () => {
  it("matches the documented shape", () =>
    expect(summarizeGeneratorForm(values({ prefix: "424242", network: "Visa" }))).toBe(
      "Visa · 16 digits · Auto expiry · Auto CVV · 10 fixtures",
    ));
  it("summarizes a custom expiry and CVV", () =>
    expect(
      summarizeGeneratorForm(
        values({
          prefix: "371234",
          network: "American Express",
          expiryMode: "custom",
          month: 12,
          year: Y + 1,
          cvvMode: "custom",
          cvvValue: "1234",
          quantity: 5,
        }),
      ),
    ).toBe("Amex · 15 digits · Expiry 12/27 · Custom CVV (4 digits) · 5 fixtures"));
  it("handles the singular fixture", () =>
    expect(summarizeGeneratorForm(values({ quantity: 1 }))).toContain("1 fixture"));
  it("summarizes Auto BIN mode across the compatible networks", () =>
    expect(summarizeGeneratorForm(values({ binMode: "auto", prefix: "" }))).toBe(
      "Auto network · 14–19 digits · Auto expiry · Auto CVV · 10 fixtures",
    ));
  it("summarizes a detected single network", () =>
    expect(summarizeGeneratorForm(values({ prefix: "424242" }))).toContain("Visa · 16 digits"));
  it("never claims real accounts", () => {
    const summary = summarizeGeneratorForm(values());
    expect(summary.toLowerCase()).not.toContain("live");
    expect(summary.toLowerCase()).not.toContain("real");
  });
});

describe("prepared generator options keep existing rules", () => {
  it("maps Auto to the existing Random network behaviour", () =>
    expect(
      prepareGeneratorOptions({
        ...form,
        prefix: "",
        network: "Auto",
        expiryMode: "auto",
        cvv: "auto",
      }).network,
    ).toBe("Random"));
  it("drops custom CVV values when Auto is selected", () => {
    const prepared = prepareGeneratorOptions({
      ...form,
      prefix: "424242",
      network: "Auto",
      expiryMode: "auto",
      cvv: "auto",
      cvvValue: "123",
    });
    expect(prepared.cvvValue).toBeUndefined();
  });
  it("never touches the prefix in Auto mode", () => {
    const prepared = prepareGeneratorOptions({
      ...form,
      network: "Auto",
      prefix: "",
      expiryMode: "auto",
      cvv: "auto",
    });
    expect(prepared.prefix).toBe("");
  });
});

describe("the gate that blocks generation", () => {
  it("reports no errors for a clean error set", () => {
    expect(hasFieldErrors({})).toBe(false);
  });
  it.each([
    [{ prefix: "Enter 6–8 digits." }],
    [{ network: "Visa does not match this BIN." }],
    [{ expiry: "Choose an expiry month after the current month." }],
    [{ cvv: "Enter 3 or 4 digits only." }],
    [{ quantity: "Choose a whole number of fixtures between 1 and 100." }],
  ])("reports an error when %j is present", (errors) => {
    expect(hasFieldErrors(errors)).toBe(true);
  });
  it("agrees with validateGeneratorForm for valid and invalid input", () => {
    expect(hasFieldErrors(validateGeneratorForm({ ...form }, now))).toBe(false);
    expect(
      hasFieldErrors(validateGeneratorForm({ ...form, prefix: "abc" }, now)),
    ).toBe(true);
  });
});
