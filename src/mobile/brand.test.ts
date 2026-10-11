/**
 * Brand consistency guards.
 *
 * ORIGEN's identity is spread across a CSS file, a handful of Android XML
 * resources and two HTML entry documents. These tests keep the copies of each
 * fact in agreement, so a palette or name change in one place cannot quietly
 * leave the others behind. They also lock in the two typography rules the
 * design system depends on: uppercase is a CSS treatment, never a source
 * string, and the type scale is referenced through tokens.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const mobileCss = read("../../src/mobile/styles/mobile.css");
const colorsXml = read("../../android/app/src/main/res/values/colors.xml");
const launcherBackgroundXml = read("../../android/app/src/main/res/values/ic_launcher_background.xml");
const stringsXml = read("../../android/app/src/main/res/values/strings.xml");
const stylesXml = read("../../android/app/src/main/res/values/styles.xml");
const capacitorConfig = read("../../capacitor.config.ts");
const mobileConfig = read("../../src/mobile/config.ts");
const mobileHtml = read("../../mobile/index.html");
const webHtml = read("../../index.html");
const foreground = read("../../android/app/src/main/res/drawable/ic_launcher_foreground.xml");
const monochrome = read("../../android/app/src/main/res/drawable/ic_launcher_monochrome.xml");
const splash = read("../../android/app/src/main/res/drawable/ic_splash_brand.xml");

const cssVar = (name: string): string => {
  const match = mobileCss.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"));
  expect(match, `${name} is defined in mobile.css`).not.toBeNull();
  return (match?.[1] ?? "").trim();
};
const androidColor = (xml: string, name: string): string => {
  const match = xml.match(new RegExp(`<color name="${name}">(#[0-9A-Fa-f]{6})</color>`));
  expect(match, `${name} is defined`).not.toBeNull();
  return (match?.[1] ?? "").toLowerCase();
};

/** Relative luminance and WCAG contrast ratio. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Absolute points of a `<path>`. Only the commands the ORIGEN mark uses are
 * handled (M/m, L/l, H/h, V/v); anything else throws, so a future mark that
 * needs curves fails here loudly instead of being measured wrongly.
 */
function pathPoints(pathData: string): [number, number][] {
  const points: [number, number][] = [];
  const tokens = pathData.match(/[MmLlHhVv]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let command = "";
  let x = 0;
  let y = 0;
  const numbers: number[] = [];
  const step = () => {
    switch (command) {
      case "M":
        x = numbers[0];
        y = numbers[1];
        break;
      case "m":
        x += numbers[0];
        y += numbers[1];
        break;
      case "L":
        x = numbers[0];
        y = numbers[1];
        break;
      case "l":
        x += numbers[0];
        y += numbers[1];
        break;
      case "H":
        x = numbers[0];
        break;
      case "h":
        x += numbers[0];
        break;
      case "V":
        y = numbers[0];
        break;
      case "v":
        y += numbers[0];
        break;
      default:
        throw new Error(`Unhandled path command "${command}" in the brand mark.`);
    }
    points.push([x, y]);
    numbers.length = 0;
  };
  for (const token of tokens) {
    if (/^[MmLlHhVv]$/.test(token)) {
      // An `m` after the first coordinate pair behaves as `l`.
      if (command === "m" && numbers.length === 2) step();
      command = token;
    } else numbers.push(Number.parseFloat(token));
    const width = command === "" ? 0 : "HhVv".includes(command) ? 1 : 2;
    if (numbers.length === width) step();
  }
  if (numbers.length) step();
  return points;
}

/** Inked bounding box of the vector: its path grown by the stroke, then scaled. */
function inkedBox(xml: string) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const pathData of xml.matchAll(/android:pathData="([^"]+)"/g))
    for (const [x, y] of pathPoints(pathData[1])) {
      xs.push(x);
      ys.push(y);
    }
  const stroke = Number.parseFloat(xml.match(/android:strokeWidth="([\d.]+)"/)?.[1] ?? "0");
  const number = (name: string, fallback: number) => Number.parseFloat(xml.match(new RegExp(`android:${name}="(-?[\\d.]+)"`))?.[1] ?? String(fallback));
  return {
    width: Math.max(...xs) - Math.min(...xs) + stroke,
    height: Math.max(...ys) - Math.min(...ys) + stroke,
    centreX: (Math.max(...xs) + Math.min(...xs)) / 2,
    centreY: (Math.max(...ys) + Math.min(...ys)) / 2,
    scale: number("scaleX", 1),
    translateX: number("translateX", 0),
    translateY: number("translateY", 0),
  };
}

describe("ORIGEN brand palette", () => {
  it("keeps the Android launch colours identical to the mobile design tokens", () => {
    expect(androidColor(colorsXml, "origen_background")).toBe(cssVar("--bg"));
    expect(androidColor(colorsXml, "origen_surface")).toBe(cssVar("--surface"));
    expect(androidColor(colorsXml, "origen_accent")).toBe(cssVar("--accent"));
    expect(androidColor(colorsXml, "origen_accent_ink")).toBe(cssVar("--accent-ink"));
  });

  it("uses the brand mint as the adaptive icon background", () => {
    expect(androidColor(launcherBackgroundXml, "ic_launcher_background")).toBe(cssVar("--accent"));
  });

  it("keeps the launch window charcoal, matching the bundled page's default theme", () => {
    expect(androidColor(colorsXml, "origen_background")).toBe("#101210");
    expect(mobileHtml).toContain('data-theme="dark"');
    expect(mobileHtml).toContain('<meta name="theme-color" content="#101210" />');
  });

  it("meets WCAG AA for body, muted and faint text in both themes", () => {
    // Dark (the default): measured against the background the text sits on.
    expect(contrast(cssVar("--text").slice(0, 7), "#101210")).toBeGreaterThan(7);
    expect(contrast(cssVar("--muted").slice(0, 7), "#101210")).toBeGreaterThan(4.5);
    expect(contrast(cssVar("--faint").slice(0, 7), "#101210")).toBeGreaterThan(4.5);
    expect(contrast(cssVar("--accent-ink").slice(0, 7), cssVar("--accent").slice(0, 7))).toBeGreaterThan(4.5);
    // Light.
    const light = mobileCss.slice(mobileCss.indexOf(':root[data-theme="light"]'));
    const lightVar = (name: string) => light.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))![1].trim();
    expect(contrast(lightVar("--text").slice(0, 7), lightVar("--bg").slice(0, 7))).toBeGreaterThan(7);
    expect(contrast(lightVar("--muted").slice(0, 7), lightVar("--surface").slice(0, 7))).toBeGreaterThan(4.5);
    expect(contrast(lightVar("--faint").slice(0, 7), lightVar("--bg").slice(0, 7))).toBeGreaterThan(4.5);
  });

  it("gives every filled surface an ink that clears WCAG AA in both themes", () => {
    // Danger is pale in Dark and deep in Light, so the ink on it is a token
    // rather than a literal. A hardcoded foreground here measured 2.8:1 in
    // Light before it became one.
    const light = mobileCss.slice(mobileCss.indexOf(':root[data-theme="light"]'));
    const lightVar = (name: string) => light.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))![1].trim();
    const hex = (value: string) => value.trim().slice(0, 7);
    for (const read of [cssVar, lightVar]) {
      expect(contrast(hex(read("--danger-ink")), hex(read("--danger")))).toBeGreaterThan(4.5);
      expect(contrast(hex(read("--accent-ink")), hex(read("--accent")))).toBeGreaterThan(4.5);
    }
    // No filled surface may hardcode its foreground.
    const rules = mobileCss.slice(mobileCss.indexOf("*,\n*::before"));
    for (const selector of [".btn-danger", ".toast-error", ".btn-primary"]) {
      const block = rules.match(new RegExp(`\\${selector} \\{([^}]*)\\}`))![1];
      expect(block, `${selector} takes its ink from a token`).toContain("color: var(");
    }
    expect(rules).not.toMatch(/color:\s*#[0-9a-fA-F]{3,8}\s*;/);
  });
});

describe("ORIGEN app name", () => {
  const strings = (name: string) => stringsXml.match(new RegExp(`<string name="${name}">([^<]+)</string>`))![1];

  it("is the same string in the manifest, Capacitor, the mobile config and both documents", () => {
    expect(strings("app_name")).toBe("ORIGEN");
    expect(strings("title_activity_main")).toBe("ORIGEN");
    expect(capacitorConfig).toContain('appName: "ORIGEN"');
    expect(mobileConfig).toContain('appName: "ORIGEN"');
    expect(mobileHtml).toContain("<title>ORIGEN</title>");
    expect(webHtml).toContain("<title>ORIGEN — Payment Testing Toolkit</title>");
    expect(read("../../android/app/src/main/AndroidManifest.xml")).toContain('android:label="@string/app_name"');
  });
});

describe("ORIGEN brand mark", () => {
  const braces = "M15,10h-3v7l-3,3 3,3v7h3m10,-20h3v7l3,3 -3,3v7h-3";

  it("draws one mark in the launcher foreground, the themed layer and the splash", () => {
    expect(foreground).toContain(braces);
    expect(monochrome).toContain(braces);
    expect(splash).toContain(braces);
    expect(read("../../public/favicon.svg")).toContain("M15 10h-3v7l-3 3 3 3v7h3m10-20h3v7l3 3-3 3v7h-3");
  });

  it("keeps the launcher mark inside the adaptive-icon safe zone", () => {
    // The inner two-thirds of a 108dp adaptive icon — a 72dp circle — is the
    // area every launcher mask is guaranteed to show.
    const box = inkedBox(foreground);
    const diameter = Math.hypot(box.width, box.height) * box.scale;
    expect(box.centreX * box.scale + box.translateX).toBe(54);
    expect(box.centreY * box.scale + box.translateY).toBe(54);
    expect(diameter).toBeLessThanOrEqual(72);
  });

  it("keeps the splash mark inside the 192dp splash mask and readable on the splash background", () => {
    // Splash icons with no background use a 288dp canvas masked to a 192dp circle.
    const box = inkedBox(splash);
    expect(splash).toContain('android:viewportWidth="288"');
    expect(box.centreX * box.scale + box.translateX).toBe(144);
    expect(box.centreY * box.scale + box.translateY).toBe(144);
    expect(Math.hypot(box.width, box.height) * box.scale).toBeLessThanOrEqual(192);
    const stroke = splash.match(/android:strokeColor="(#[0-9A-Fa-f]{6})"/)![1].toLowerCase();
    expect(stroke).toBe(cssVar("--accent"));
    expect(contrast(stroke, androidColor(colorsXml, "origen_background"))).toBeGreaterThan(4.5);
  });

  it("points the launch theme at the splash mark", () => {
    expect(stylesXml).toContain("<item name=\"windowSplashScreenAnimatedIcon\">@drawable/ic_splash_brand</item>");
    expect(stylesXml).toContain("<item name=\"windowSplashScreenBackground\">@color/origen_background</item>");
  });
});

describe("ORIGEN typography system", () => {
  // Everything after the token block, i.e. the rules that consume the tokens.
  const rules = mobileCss.slice(mobileCss.indexOf("*,\n*::before"));

  it("sets one interface family and one monospace family", () => {
    expect(cssVar("--font-ui")).toMatch(/^Roboto, Inter, /);
    expect(cssVar("--mono")).toMatch(/monospace$/);
    expect(mobileCss).toContain("font-family: var(--font-ui);");
    const families = [...rules.matchAll(/font-family:\s*([^;]+);/g)].map((match) => match[1].trim());
    expect(families.length).toBeGreaterThan(0);
    expect(families.filter((value) => !value.startsWith("var("))).toEqual([]);
  });

  it("references the scale through tokens instead of literals", () => {
    for (const property of ["font-size", "font-weight", "line-height"]) {
      const literals = [...rules.matchAll(new RegExp(`${property}:\\s*([^;]+);`, "g"))]
        .map((match) => match[1].trim())
        .filter((value) => !value.startsWith("var("));
      expect(literals, `${property} declarations are tokenised`).toEqual([]);
    }
    // Letter spacing has exactly one deliberate literal: tracking is dropped at
    // 320px so the navigation labels still fit.
    const tracking = [...rules.matchAll(/letter-spacing:\s*([^;]+);/g)].map((match) => match[1].trim());
    expect(tracking.filter((value) => !value.startsWith("var("))).toEqual(["0"]);
  });

  it("applies uppercase as presentation only, and only to micro-labels", () => {
    const uppercased = [...mobileCss.matchAll(/^([.:#\w[\]=" -]+)\{[^}]*text-transform:\s*uppercase/gm)].map((m) => m[1].trim());
    expect([...uppercased].sort()).toEqual([".badge", ".brand-name"]);
  });

  it("never re-cases text at runtime", () => {
    for (const file of ["tools/generator.ts", "tools/lookup.ts", "tools/sorter.ts", "tools/settings.ts", "tools/help.ts", "shell.ts", "ui/components.ts", "ui/community.ts"]) {
      expect(read(`../../src/mobile/${file}`), `${file} does not re-case UI text`).not.toContain(".toUpperCase()");
    }
  });

  it("authors micro-labels in sentence case rather than shouting them", () => {
    // Uppercase belongs in CSS. The only all-caps strings left are the
    // logotype, the fixture stamp, acronyms and two DOM tag comparisons.
    const allowed = new Set(["ORIGEN", "SYNTHETIC TEST FIXTURE", "BIN / IIN", "JSON", "INPUT", "SELECT"]);
    const literal = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
    const shouty = /^[A-Z0-9][A-Z0-9 ·/|—–.'-]{3,}$/;
    const offenders: string[] = [];
    for (const file of ["shell.ts", "ui/components.ts", "ui/sheet.ts", "ui/toast.ts", "tools/generator.ts", "tools/lookup.ts", "tools/sorter.ts", "tools/settings.ts"]) {
      const source = read(`../../src/mobile/${file}`);
      for (const line of source.split("\n")) {
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
        for (const match of line.matchAll(literal)) {
          const value = match[1] ?? match[2] ?? match[3] ?? "";
          if (allowed.has(value) || !shouty.test(value) || !/[A-Z]/.test(value)) continue;
          offenders.push(`${file}: ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
