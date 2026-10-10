import { describe, expect, it, vi } from "vitest";
import { LookupError, type BinMetadata } from "../../guison";
import { BinServiceError, createGuisonService, OFFLINE_MESSAGE } from "./bin-service";

const metadata = { bin: "457173", scheme: "visa" } as BinMetadata;
const instantSleep = vi.fn(async () => {});

function service(overrides: Partial<Parameters<typeof createGuisonService>[0]> = {}) {
  let online = true;
  const lookupFn = vi.fn(async () => metadata);
  const statusFn = vi.fn(async () => {});
  const svc = createGuisonService({
    origin: "https://bin.example.com",
    label: "Example",
    network: { isOnline: () => online },
    lookupFn,
    statusFn,
    sleep: instantSleep,
    ...overrides,
  });
  return { svc, lookupFn, statusFn, setOnline: (value: boolean) => (online = value) };
}

describe("BIN metadata service", () => {
  it("passes the configured origin to the Guison client", async () => {
    const { svc, lookupFn, statusFn } = service();
    const controller = new AbortController();
    await expect(svc.lookup("457173", controller.signal)).resolves.toBe(metadata);
    expect(lookupFn).toHaveBeenCalledWith("457173", controller.signal, "https://bin.example.com");
    await svc.checkStatus();
    expect(statusFn).toHaveBeenCalledWith(undefined, "https://bin.example.com");
    expect(svc.origin).toBe("https://bin.example.com");
    expect(svc.label).toBe("Example");
  });

  it("fails honestly and immediately when offline, without a request", async () => {
    const { svc, lookupFn, setOnline } = service();
    setOnline(false);
    const error = await svc.lookup("457173").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(BinServiceError);
    expect((error as BinServiceError).code).toBe("offline");
    expect((error as BinServiceError).message).toBe(OFFLINE_MESSAGE);
    expect((error as BinServiceError).retryable).toBe(true);
    expect(lookupFn).not.toHaveBeenCalled();
  });

  it("retries one transient outage, then succeeds", async () => {
    const lookupFn = vi
      .fn()
      .mockRejectedValueOnce(new LookupError("unavailable", "down"))
      .mockResolvedValueOnce(metadata);
    const { svc } = service({ lookupFn });
    await expect(svc.lookup("457173")).resolves.toBe(metadata);
    expect(lookupFn).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget and reports the real error", async () => {
    const lookupFn = vi.fn().mockRejectedValue(new LookupError("unavailable", "Guison is unavailable."));
    const { svc } = service({ lookupFn, retries: 2 });
    await expect(svc.lookup("457173")).rejects.toMatchObject({ code: "unavailable", message: "Guison is unavailable." });
    expect(lookupFn).toHaveBeenCalledTimes(3);
  });

  it.each(["not_found", "timeout", "rate_limit", "invalid_response", "invalid_input"] as const)(
    "does not retry %s",
    async (code) => {
      const lookupFn = vi.fn().mockRejectedValue(new LookupError(code, code));
      const { svc } = service({ lookupFn });
      await expect(svc.lookup("457173")).rejects.toMatchObject({ code });
      expect(lookupFn).toHaveBeenCalledTimes(1);
    },
  );

  it("marks only transient failures as retryable", () => {
    expect(new BinServiceError("not_found", "").retryable).toBe(false);
    expect(new BinServiceError("invalid_input", "").retryable).toBe(false);
    expect(new BinServiceError("cancelled", "").retryable).toBe(false);
    expect(new BinServiceError("timeout", "").retryable).toBe(true);
  });

  it("reports offline if the connection drops during a retry wait", async () => {
    const lookupFn = vi.fn().mockRejectedValue(new LookupError("unavailable", "down"));
    const ctx = service({ lookupFn });
    instantSleep.mockImplementationOnce(async () => void ctx.setOnline(false));
    await expect(ctx.svc.lookup("457173")).rejects.toMatchObject({ code: "offline" });
  });

  it("keeps validation messages from the BIN validator", async () => {
    const lookupFn = vi.fn().mockRejectedValue(new Error("Enter 6–8 digits."));
    const { svc } = service({ lookupFn });
    await expect(svc.lookup("12")).rejects.toMatchObject({ code: "invalid_input", message: "Enter 6–8 digits." });
  });

  it("maps unknown throwables to a generic unavailable error", async () => {
    const lookupFn = vi.fn().mockRejectedValue("boom");
    const { svc } = service({ lookupFn });
    await expect(svc.lookup("457173")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("does not retry after the caller cancels", async () => {
    const controller = new AbortController();
    const lookupFn = vi.fn(async () => {
      controller.abort();
      throw new LookupError("unavailable", "down");
    });
    const { svc } = service({ lookupFn });
    await expect(svc.lookup("457173", controller.signal)).rejects.toMatchObject({ code: "unavailable" });
    expect(lookupFn).toHaveBeenCalledTimes(1);
  });

  describe("default abortable wait", () => {
    it("waits between attempts and can be cancelled while waiting", async () => {
      vi.useFakeTimers();
      try {
        const lookupFn = vi.fn().mockRejectedValue(new LookupError("unavailable", "down"));
        const { svc } = service({ lookupFn, sleep: undefined, retryDelayMs: 1000 });
        const controller = new AbortController();
        const pending = svc.lookup("457173", controller.signal).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(10);
        controller.abort();
        expect(await pending).toMatchObject({ code: "cancelled" });
        expect(lookupFn).toHaveBeenCalledTimes(1);

        const second = svc.lookup("457173").catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(1000);
        expect(await second).toMatchObject({ code: "unavailable" });
        expect(lookupFn).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects at once when already cancelled before waiting", async () => {
      const controller = new AbortController();
      const lookupFn = vi.fn(async () => {
        throw new LookupError("unavailable", "down");
      });
      const { svc } = service({ lookupFn, sleep: undefined });
      // Abort between the failure and the wait by aborting synchronously in a microtask.
      const pending = svc.lookup("457173", controller.signal);
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: "unavailable" });
    });
  });
});
