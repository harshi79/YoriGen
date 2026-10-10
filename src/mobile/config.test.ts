import { describe, expect, it } from "vitest";
import { createConfig, normalizeOrigin } from "./config";
import { GUISON_ORIGIN } from "../guison";

describe("mobile config", () => {
  it("uses the public Guison API by default", () => {
    const config = createConfig({}, "1.2.3");
    expect(config.binApiOrigin).toBe(GUISON_ORIGIN);
    expect(config.binApiLabel).toBe("Guison API");
    expect(config.version).toBe("1.2.3");
    expect(config.appName).toBe("ORIGEN");
  });

  it("accepts a bare HTTPS origin override and labels it by host", () => {
    const config = createConfig({ VITE_ORIGEN_BIN_API_ORIGIN: " https://bin.example.com/ " });
    expect(config.binApiOrigin).toBe("https://bin.example.com");
    expect(config.binApiLabel).toBe("bin.example.com");
    expect(config.version).toBe("0.0.0-dev");
  });

  it.each([
    "http://bin.example.com",
    "https://user:pass@bin.example.com",
    "https://bin.example.com/v1",
    "https://bin.example.com/?key=secret",
    "https://bin.example.com/#x",
    "not a url",
    "",
  ])("rejects the unsafe origin %j", (value) => {
    expect(normalizeOrigin(value)).toBeNull();
    expect(createConfig({ VITE_ORIGEN_BIN_API_ORIGIN: value }).binApiOrigin).toBe(GUISON_ORIGIN);
  });

  it("ships no credentials, only public links", () => {
    const config = createConfig();
    expect(JSON.stringify(config)).not.toMatch(/key|token|secret|password/i);
    expect(config.communityUrl).toMatch(/^https:\/\/t\.me\//);
    expect(config.sourceUrl).toMatch(/^https:\/\/github\.com\//);
  });
});
