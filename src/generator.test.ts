import { describe, expect, it } from "vitest";
import {
  cardDigits,
  cardLengths,
  checkDigit,
  compatibleNetworks,
  cvvDigits,
  displayName,
  displayNumber,
  formatRecords,
  generateCards,
  lengthLabel,
  luhnValid,
  NETWORKS,
  validateOptions,
  type GeneratorOptions,
} from "./generator";
const now = new Date(2026, 8, 29);
const base: GeneratorOptions = {
  prefix: "",
  network: "Random",
  quantity: 10,
  expiryMode: "random",
  month: 1,
  year: 2027,
  cvv: "auto",
};
const generate = (overrides: Partial<GeneratorOptions> = {}) =>
  generateCards({ ...base, ...overrides }, now);
describe("Luhn implementation", () => {
  it("calculates a known mathematical checksum", () => {
    expect(checkDigit("7992739871")).toBe("3");
    expect(luhnValid("79927398713")).toBe(true);
  });
  it.each(["79927398714", "", "x123", "4", "12 34", "12345678901234567890"])(
    "rejects malformed or incorrect checksum %s",
    (number) => expect(luhnValid(number)).toBe(false),
  );
  it("rejects nonnumeric bodies", () => {
    expect(() => checkDigit("")).toThrow();
    expect(() => checkDigit("123x")).toThrow();
  });
  it("handles zeros and leading zeros", () => {
    expect(checkDigit("000000")).toBe("0");
    expect(luhnValid("0000000")).toBe(true);
  });
});
describe("network matching and generation", () => {
  it.each(NETWORKS)(
    "generates correct lengths and CVV widths for %s",
    (network) => {
      const rows = generate({ network, quantity: 100 });
      expect(rows).toHaveLength(100);
      const lengths = cardLengths(network);
      const cvvWidth = cvvDigits(network);
      for (const row of rows) {
        expect(row.network).toBe(network);
        expect(row.synthetic).toBe(true);
        expect(lengths).toContain(row.number.length);
        expect(row.cvv).toMatch(
          new RegExp(`^\\d{${cvvWidth}}$`),
        );
        expect(luhnValid(row.number)).toBe(true);
        expect(compatibleNetworks(row.number)).toContain(network);
      }
    },
  );
  it.each([
    ["4", "Visa"],
    ["42424242", "Visa"],
    ["51", "Mastercard"],
    ["55", "Mastercard"],
    ["2221", "Mastercard"],
    ["2720", "Mastercard"],
    ["34", "American Express"],
    ["37", "American Express"],
    ["6011", "Discover"],
    ["644", "Discover"],
    ["649", "Discover"],
    ["65", "Discover"],
    ["622126", "Discover"],
    ["622925", "Discover"],
  ] as const)("preserves requested prefix %s for %s", (prefix, network) => {
    for (const row of generate({ prefix, network })) {
      expect(row.number.startsWith(prefix)).toBe(true);
      expect(luhnValid(row.number)).toBe(true);
    }
  });
  it.each([
    ["4", "Mastercard"],
    ["51", "Visa"],
    ["36", "American Express"],
    ["2220", "Mastercard"],
    ["2721", "Mastercard"],
    ["50", "Mastercard"],
    ["56", "Mastercard"],
    ["622125", "Discover"],
    ["622926", "Discover"],
    ["643", "Discover"],
    ["650", "Visa"],
  ] as const)("rejects incompatible %s / %s", (prefix, network) =>
    expect(() => generate({ prefix, network })).toThrow(/not compatible/),
  );
  it.each(["2", "3", "5", "6", "622", "222", "27"])(
    "extends partial prefix %s without changing it",
    (prefix) => {
      for (const row of generate({ prefix, quantity: 100 }))
        expect(row.number.startsWith(prefix)).toBe(true);
    },
  );
  it("random network respects a supplied prefix", () => {
    for (const row of generate({ prefix: "37" }))
      expect(row.network).toBe("American Express");
  });
  it("rejects unsupported prefixes rather than fabricating a network", () =>
    expect(() => generate({ prefix: "9" })).toThrow(/not compatible/));
  it.each(["123456789", "12x", " 4", "4 ", "-4", "4.2", "４２"])(
    "rejects invalid prefix %s",
    (prefix) => expect(() => generate({ prefix })).toThrow(/1–8 digits/),
  );
  it("rejects complete card-like values even at the low-level generator boundary", () => {
    expect(() => generate({ prefix: "42424242424242" })).toThrow(
      "Please enter a BIN/IIN prefix or masked synthetic template, not a complete card number.",
    );
  });
  it("validates masked template widths and network-specific lengths", () => {
    expect(() => generate({ prefix: "424242", templateLength: 12 })).toThrow(
      /valid masked synthetic template/,
    );
    expect(() => generate({ prefix: "424242", templateLength: 14 })).toThrow(
      /not supported by any compatible network/,
    );
    expect(
      () => generate({ prefix: "424242", templateLength: 14, network: "Visa" }),
    ).toThrow(/not supported by Visa/);
  });
});
describe("extended network formats", () => {
  it.each([
    ["3528", "JCB"],
    ["3589", "JCB"],
    ["353011", "JCB"],
    ["300", "Diners Club"],
    ["305", "Diners Club"],
    ["3095", "Diners Club"],
    ["36", "Diners Club"],
    ["38", "Diners Club"],
    ["39", "Diners Club"],
    ["62", "UnionPay"],
    ["81", "UnionPay"],
    ["5018", "Maestro"],
    ["5020", "Maestro"],
    ["5038", "Maestro"],
    ["56", "Maestro"],
    ["6759", "Maestro"],
    ["6761", "Maestro"],
    ["6763", "Maestro"],
    ["60", "RuPay"],
    ["65", "RuPay"],
    ["8214", "RuPay"],
    ["8220", "RuPay"],
  ] as const)("preserves requested prefix %s for %s", (prefix, network) => {
    for (const row of generate({ prefix, network, quantity: 5 })) {
      expect(row.network).toBe(network);
      expect(row.number.startsWith(prefix)).toBe(true);
      expect(luhnValid(row.number)).toBe(true);
    }
  });
  it.each([
    ["3527", "JCB"],
    ["3590", "JCB"],
    ["306", "Diners Club"],
    ["37", "Diners Club"],
    ["622125", "Discover"],
    ["643", "Discover"],
    ["5019", "Maestro"],
    ["55", "Maestro"],
    ["70", "Maestro"],
    ["90", "Maestro"],
    ["8213", "RuPay"],
    ["8221", "RuPay"],
  ] as const)("rejects out-of-range %s / %s", (prefix, network) =>
    expect(() => generate({ prefix, network })).toThrow(/not compatible/),
  );
  it("builds every accepted length for a variable-length network", () => {
    for (const network of [
      "JCB",
      "UnionPay",
      "Maestro",
      "Diners Club",
    ] as const) {
      const lengths = cardLengths(network);
      const seen = new Set<number>();
      // Quantity is capped at 100 per run, so sample repeatedly instead.
      for (let run = 0; run < 40; run += 1)
        for (const row of generate({ network, quantity: 100 }))
          seen.add(row.number.length);
      expect([...seen].sort((a, b) => a - b)).toEqual([...lengths]);
    }
  });
  it("never generates a number shorter than its prefix plus a check digit", () => {
    for (const row of generate({ prefix: "353011", network: "JCB", quantity: 50 }))
      expect(row.number.length).toBeGreaterThanOrEqual(7);
  });
  it("keeps the whole prefix even when it outruns the shortest variant", () => {
    // Diners accepts 14 digits; an 8-digit prefix needs at least 9.
    for (const row of generate({ prefix: "30569312", network: "Diners Club", quantity: 50 })) {
      expect(row.number.startsWith("30569312")).toBe(true);
      expect(row.number.length).toBeGreaterThanOrEqual(9);
      expect(cardLengths("Diners Club")).toContain(row.number.length);
      expect(luhnValid(row.number)).toBe(true);
    }
  });
  it("reports the shortest accepted length per network", () => {
    expect(cardDigits("American Express")).toBe(15);
    expect(cardDigits("Diners Club")).toBe(14);
    expect(cardDigits("Visa")).toBe(16);
    expect(cardDigits("JCB")).toBe(16);
    for (const network of NETWORKS)
      expect(cardDigits(network)).toBe(cardLengths(network)[0]);
  });
  it("keeps overlapping ranges resolvable for every compatible network", () => {
    expect(compatibleNetworks("51")).toContain("Mastercard");
    expect(compatibleNetworks("56")).toContain("Maestro");
    expect(compatibleNetworks("62")).toContain("Discover");
    expect(compatibleNetworks("62")).toContain("UnionPay");
    expect(compatibleNetworks("65")).toContain("Discover");
    expect(compatibleNetworks("65")).toContain("RuPay");
    expect(compatibleNetworks("81")).toContain("UnionPay");
    expect(compatibleNetworks("81")).toContain("RuPay");
  });
  it("reports a length range for variable-length networks", () => {
    expect(cardLengths("Diners Club")).toEqual([14, 15, 16, 17, 18, 19]);
    expect(cardLengths("Visa")).toEqual([16]);
    expect(lengthLabel([16])).toBe("16 digits");
    expect(lengthLabel([14, 15, 16, 17, 18, 19])).toBe("14–19 digits");
    expect(lengthLabel([])).toBe("length pending");
  });
  it("shortens long names for badges and summaries", () => {
    expect(displayName("Diners Club")).toBe("Diners");
    expect(displayName("American Express")).toBe("Amex");
    expect(displayName("UnionPay")).toBe("UnionPay");
  });
});
describe("limits and CVV validation", () => {
  it.each([0, -1, 101, 1.5, Infinity, NaN])("rejects quantity %s", (quantity) =>
    expect(() => generate({ quantity })).toThrow(/between 1 and 100/),
  );
  it.each([1, 100])("accepts boundary quantity %s", (quantity) =>
    expect(generate({ quantity })).toHaveLength(quantity),
  );
  it("rejects a four-digit CVV request for Visa", () =>
    expect(() => generate({ network: "Visa", cvv: "4" })).toThrow(
      /CVV format/,
    ));
  it("rejects a three-digit CVV request for Amex", () =>
    expect(() => generate({ network: "American Express", cvv: "3" })).toThrow(
      /CVV format/,
    ));
  it("does not silently restrict Random networks based on CVV", () =>
    expect(() => generate({ cvv: "3" })).toThrow(/CVV format/));
  it("supports explicit compatible CVV format", () =>
    expect(
      generate({ network: "American Express", cvv: "4" })[0].cvv,
    ).toHaveLength(4));
  it("validates untrusted enum values", () => {
    expect(() =>
      generate({ network: "Unknown" as GeneratorOptions["network"] }),
    ).toThrow(/supported card network/);
    expect(() => generate({ cvv: "5" as GeneratorOptions["cvv"] })).toThrow(
      /supported CVV/,
    );
    expect(() =>
      generate({ expiryMode: "past" as GeneratorOptions["expiryMode"] }),
    ).toThrow(/supported expiry/);
  });
});
describe("future expiry dates", () => {
  it("uses future months only", () => {
    for (const row of generate({ quantity: 100 })) {
      expect(Number(row.month)).toBeGreaterThanOrEqual(1);
      expect(Number(row.month)).toBeLessThanOrEqual(12);
      expect(Number(row.year) * 12 + Number(row.month)).toBeGreaterThan(
        26 * 12 + 9,
      );
    }
  });
  it("keeps a selected month", () =>
    expect(
      generate({ expiryMode: "month", month: 2 }).every(
        (r) => r.month === "02",
      ),
    ).toBe(true));
  it("keeps a selected year", () =>
    expect(
      generate({ expiryMode: "year", year: 2028 }).every(
        (r) => r.year === "28",
      ),
    ).toBe(true));
  it("keeps a fixed expiry", () =>
    expect(
      generate({ expiryMode: "fixed", month: 11, year: 2027 }).every(
        (r) => r.month === "11" && r.year === "27",
      ),
    ).toBe(true));
  it.each([0, 13, 1.5, NaN])("rejects invalid month %s", (month) =>
    expect(() => generate({ expiryMode: "month", month })).toThrow(
      /month between/,
    ),
  );
  it.each([2025, 2037, NaN, 2027.5])("rejects invalid year %s", (year) =>
    expect(() => generate({ expiryMode: "year", year })).toThrow(
      /next 10 years/,
    ),
  );
  it("rejects past and current-month fixed expiry", () => {
    for (const month of [1, 9])
      expect(() =>
        generate({ expiryMode: "fixed", month, year: 2026 }),
      ).toThrow(/after the current month/);
  });
  it("handles December rollover", () => {
    const date = new Date(2026, 11, 31);
    expect(() =>
      validateOptions({ ...base, expiryMode: "year", year: 2026 }, date),
    ).toThrow(/after the current month/);
    expect(generateCards(base, date).every((r) => Number(r.year) >= 27)).toBe(
      true,
    );
  });
});
describe("builder expiry modes (auto / custom)", () => {
  it("treats auto as the existing random future expiry", () => {
    for (const row of generate({ expiryMode: "auto", quantity: 100 }))
      expect(Number(row.year) * 12 + Number(row.month)).toBeGreaterThan(
        26 * 12 + 9,
      );
  });
  it("treats custom as one fixed synthetic future month and year", () => {
    const rows = generate({ expiryMode: "custom", month: 11, year: 2027 });
    expect(rows.every((r) => r.month === "11" && r.year === "27")).toBe(true);
  });
  it.each([0, 13, 1.5, NaN])("rejects a custom month %s", (month) =>
    expect(() => generate({ expiryMode: "custom", month, year: 2027 })).toThrow(
      /month between/,
    ),
  );
  it.each([2025, 2037, NaN, 2027.5])("rejects a custom year %s", (year) =>
    expect(() => generate({ expiryMode: "custom", month: 5, year })).toThrow(
      /next 10 years/,
    ),
  );
  it("rejects a custom expiry in the current month", () =>
    expect(() => generate({ expiryMode: "custom", month: 9, year: 2026 })).toThrow(
      /after the current month/,
    ));
  it("rejects an unknown expiry mode", () =>
    expect(() =>
      generate({ expiryMode: "someday" as GeneratorOptions["expiryMode"] }),
    ).toThrow(/supported expiry/));
});
describe("builder CVV modes (auto / custom)", () => {
  it("auto keeps network-correct widths", () => {
    for (const row of generate({ network: "American Express", quantity: 20 }))
      expect(row.cvv).toMatch(/^\d{4}$/);
    for (const row of generate({ network: "Visa", quantity: 20 }))
      expect(row.cvv).toMatch(/^\d{3}$/);
  });
  it("custom applies the developer's synthetic value to every record", () => {
    const rows = generate({
      network: "Visa",
      cvv: "custom",
      cvvValue: "007",
      quantity: 10,
    });
    expect(rows.every((r) => r.cvv === "007")).toBe(true);
  });
  it("custom supports the Amex width", () =>
    expect(
      generate({
        network: "American Express",
        cvv: "custom",
        cvvValue: "0000",
      })[0].cvv,
    ).toBe("0000"));
  it.each(["", "12", "12345", "abc", "12a", " 123", "１２３"])(
    "rejects malformed custom CVV %j",
    (cvvValue) =>
      expect(() =>
        generate({ network: "Visa", cvv: "custom", cvvValue }),
      ).toThrow(/3 or 4 digits/),
  );
  it("rejects a custom CVV that cannot match the requested network", () =>
    expect(() =>
      generate({ network: "Visa", cvv: "custom", cvvValue: "1234" }),
    ).toThrow(/3-digit CVV/));
  it("rejects a custom CVV while networks have different widths", () =>
    expect(() => generate({ network: "Random", cvv: "custom", cvvValue: "123" })).toThrow(
      /only match one network length/,
    ));
  it("rejects an unknown CVV option", () =>
    expect(() => generate({ cvv: "custom-length" as GeneratorOptions["cvv"] })).toThrow(
      /supported CVV/,
    ));
});
describe("output formatting", () => {
  const rows = generate({ network: "Visa", quantity: 2 });
  it("exports one pipe-separated record per line", () =>
    expect(formatRecords(rows, "pipe")).toBe(
      rows
        .map((r) => `${r.number} | ${r.month}/${r.year} | ${r.cvv}`)
        .join("\n"),
    ));
  it("exports exactly four comma-separated fields per line", () =>
    expect(formatRecords(rows, "csv")).toBe(
      rows.map((r) => `${r.number},${r.month},${r.year},${r.cvv}`).join("\n"),
    ));
  it("exports parseable JSON with synthetic labels and string values", () =>
    expect(JSON.parse(formatRecords(rows, "json"))).toEqual(rows));
  it("handles empty exports", () => {
    expect(formatRecords([], "pipe")).toBe("");
    expect(formatRecords([], "csv")).toBe("");
    expect(formatRecords([], "json")).toBe("[]");
  });
  it("groups Visa display numbers 4-4-4-4", () =>
    expect(displayNumber(rows[0])).toMatch(/^\d{4} \d{4} \d{4} \d{4}$/));
  it("groups Amex display numbers 4-6-5", () =>
    expect(displayNumber(generate({ network: "American Express" })[0])).toMatch(
      /^\d{4} \d{6} \d{5}$/,
    ));
});
