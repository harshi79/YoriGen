import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test, type CDPSession, type Page } from "@playwright/test";

/**
 * Swipe performance regression tests.
 *
 * These run against the production mobile bundle in a Pixel-class Chromium,
 * with the CPU throttled four times, and they measure the main thread while a
 * finger-paced drag is in flight. The four things they pin down are the ones
 * that made swiping lag on a physical Android phone:
 *
 *   1. nothing in the drag loop may read layout (a forced style+layout pass per
 *      pointermove is the single most expensive thing a drag can do);
 *   2. the card under the finger tracks the finger, in both directions;
 *   3. a frame of the gesture writes nothing but the card's transform and the
 *      staged veil's opacity — no custom properties, no second element
 *      restyled, no DOM built under the finger;
 *   4. the style recalculation a drag frame costs stays far below the frame
 *      budget, and dropped frames stay rare.
 *
 * What this cannot cover is the GPU raster path of a real device (shadow blur,
 * rounded clips and layer promotion policies differ from a desktop Chromium),
 * and it is not a substitute for testing on a phone. It does pin the measured
 * main-thread regression on every platform the project builds for.
 */

const METRICS_PATH = "perf-metrics/swipe-performance.json";

type Drag = {
  start(): Promise<void>;
  move(x: number, y?: number): Promise<void>;
  end(): Promise<void>;
  detach(): Promise<void>;
};

/**
 * Opens a raw CDP touch stream so a test can pause mid-gesture. `from` is the
 * point the finger lands on: tests take it from the swipe surface, so the
 * gesture starts on ordinary card surface and not on a control, which a swipe
 * is designed to leave alone.
 */
async function openTouch(page: Page, from = { x: 340, y: 460 }): Promise<Drag> {
  const cdp = await page.context().newCDPSession(page);
  return {
    start: () => cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] }).then(() => undefined),
    move: (x, y = from.y) => cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] }).then(() => undefined),
    end: () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }).then(() => undefined),
    detach: () => cdp.detach(),
  };
}

/**
 * Adds a plain, non-interactive strip inside the current screen's scroller and
 * returns points on it, so a gesture starts on ordinary card surface rather
 * than on a control (which the gesture correctly ignores). Dragging right
 * starts near the left edge and the other way round, so the whole travel stays
 * on screen.
 */
async function swipeSurface(page: Page, dx: number) {
  await page.evaluate(() => {
    document.getElementById("swipe-surface")?.remove();
    const scroller = document.querySelector(".screen-host:not([hidden]) .screen-scroll");
    if (!scroller) throw new Error("no visible screen scroller");
    const surface = document.createElement("div");
    surface.id = "swipe-surface";
    surface.style.height = "180px";
    scroller.append(surface);
    surface.scrollIntoView({ block: "center" });
  });
  const box = await page.locator("#swipe-surface").boundingBox();
  if (!box) throw new Error("the swipe surface has no box");
  const fraction = dx < 0 ? 0.8 : dx > 0 ? 0.2 : 0.5;
  return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
}

/** Horizontal offset of the card under the finger, in CSS px. */
const cardOffset = (page: Page) =>
  page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".screen-host.stack-top");
    if (!card) return null;
    return new DOMMatrixReadOnly(getComputedStyle(card).transform).m41;
  });

async function dismissPrompt(page: Page) {
  const prompt = page.getByRole("dialog", { name: "Join the Yori Community" });
  if (await prompt.count()) {
    await prompt.getByRole("button", { name: "Maybe later" }).click();
    await prompt.waitFor({ state: "detached" });
  }
}

async function boot(page: Page) {
  await page.goto("/");
  await page.reload();
  await dismissPrompt(page);
}

const nav = (page: Page, id: string) => page.locator(`.bottom-nav [data-tool="${id}"]`);
const screen = (page: Page, id: string) => page.locator(`.screen-host[data-screen="${id}"]`);
const visibleScreen = (page: Page) => page.locator(".screen-host:not([hidden])");
const title = (page: Page) => page.locator("#app-title");

/**
 * Installs a page-side drag driver: one pointermove per animation frame, so
 * every move is rendered in the frame it was produced in, with the metrics
 * counters sampled around it. Returns the frame deltas of the gesture.
 */
async function installDriver(page: Page) {
  await page.evaluate(() => {
    const api = window as unknown as { __drive(direction: -1 | 1, moves: number): Promise<number[]> };
    api.__drive = (direction: number, moves: number) =>
      new Promise((resolve) => {
        const host = document.getElementById("screens")!;
        const surface = document.querySelector<HTMLElement>(".screen-host:not([hidden])")!;
        const rect = surface.getBoundingClientRect();
        const startX = direction < 0 ? rect.width * 0.8 : rect.width * 0.2;
        const startY = rect.height * 0.5;
        const travel = direction * rect.width * 0.7;
        const frames: number[] = [];
        const fire = (type: string, x: number) =>
          host.dispatchEvent(
            new PointerEvent(type, {
              clientX: x,
              clientY: startY,
              button: 0,
              buttons: 1,
              isPrimary: true,
              pointerId: 1,
              pointerType: "touch",
              bubbles: true,
              cancelable: true,
            }),
          );
        let last = performance.now();
        let frame = 0;
        const tick = (time: number) => {
          frames.push(time - last);
          last = time;
          frame += 1;
          fire("pointermove", startX + (travel * frame) / moves);
          if (frame < moves) {
            requestAnimationFrame(tick);
            return;
          }
          fire("pointerup", startX + travel);
          resolve(frames);
        };
        fire("pointerdown", startX, startY);
        requestAnimationFrame(tick);
      });
  });
}

const drive = (page: Page, direction: -1 | 1, moves = 24) =>
  page.evaluate(
    ([dir, count]) => (window as unknown as { __drive(d: -1 | 1, m: number): Promise<number[]> }).__drive(dir, count),
    [direction, moves] as const,
  );

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test.describe("swipe performance", () => {
  test("a drag reads no layout at all, on real pointer events", async ({ page }) => {
    // The old drag loop read the host's clientWidth after writing to the DOM on
    // every move, which forced a style recalculation and a layout pass inside
    // the pointermove handler. On a phone that is several milliseconds of the
    // 16.7 ms frame, paid on every frame of the gesture.
    await page.evaluate(() => {
      const list: string[] = [];
      (window as unknown as { __layoutReads: string[] }).__layoutReads = list;
      const properties = [
        [Element.prototype, "clientWidth"],
        [Element.prototype, "clientHeight"],
        [Element.prototype, "scrollWidth"],
        [Element.prototype, "scrollHeight"],
        [HTMLElement.prototype, "offsetWidth"],
        [HTMLElement.prototype, "offsetHeight"],
      ] as const;
      for (const [target, property] of properties) {
        const descriptor = Object.getOwnPropertyDescriptor(target, property);
        if (!descriptor?.get) continue;
        Object.defineProperty(target, property, {
          configurable: true,
          get(this: Element) {
            list.push(`${this.id || this.className || this.nodeName}.${property}`);
            return descriptor.get!.call(this);
          },
        });
      }
    });

    const from = await swipeSurface(page, -240);
    const touch = await openTouch(page, from);
    await touch.start();
    for (let step = 1; step <= 12; step += 1) await touch.move(from.x - step * 20);
    await expect.poll(() => cardOffset(page)).toBeLessThan(-100);
    // Everything the gesture needed had to be measured before the finger went
    // down; a single read here means a forced layout came back into the loop.
    expect(await page.evaluate(() => (window as unknown as { __layoutReads: string[] }).__layoutReads)).toEqual([]);
    await touch.end();
    await touch.detach();
    await expect(title(page)).toHaveText("BIN Lookup");
  });

  test("the card tracks the finger one to one, in both directions", async ({ page }) => {
    const scenarios = [
      { from: "generator", direction: -1 as const, staged: "lookup", to: "BIN Lookup" },
      { from: "sorter", direction: 1 as const, staged: "lookup", to: "BIN Lookup" },
    ];
    for (const scenario of scenarios) {
      await nav(page, scenario.from).click();
      await expect(visibleScreen(page)).toHaveAttribute("data-screen", scenario.from);
      const from = await swipeSurface(page, scenario.direction * 240);
      const touch = await openTouch(page, from);
      await touch.start();
      for (const travel of [40, 80, 120, 160, 200]) {
        await touch.move(from.x + travel * scenario.direction);
        // The card is offset by exactly the finger's travel from touch-down:
        // it does not lag by the axis lock's slop or by a locked frame.
        await expect.poll(() => cardOffset(page), { timeout: 2000 }).toBeCloseTo(travel * scenario.direction, 0);
      }
      await expect(screen(page, scenario.staged)).not.toHaveAttribute("hidden");
      await expect(screen(page, scenario.staged)).toHaveClass(/stack-under/);
      await touch.move(from.x + 240 * scenario.direction);
      await touch.end();
      await touch.detach();
      await expect(title(page)).toHaveText(scenario.to);
      await boot(page);
    }
  });

  test("one frame of a drag writes nothing but a transform and an opacity", async ({ page }) => {
    const from = await swipeSurface(page, -240);
    const touch = await openTouch(page, from);
    await touch.start();
    for (let step = 1; step <= 6; step += 1) await touch.move(from.x - step * 24);
    await expect.poll(() => cardOffset(page)).toBeLessThan(-100);

    const snapshot = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>(".screen-host.stack-top")!;
      const staged = document.querySelector<HTMLElement>(".screen-host.stack-under")!;
      const veil = staged.querySelector<HTMLElement>(".screen-veil")!;
      return {
        card: card.getAttribute("style"),
        staged: staged.getAttribute("style"),
        veil: veil.getAttribute("style"),
        stagedNodes: staged.querySelectorAll("*").length,
        allNodes: document.querySelectorAll("*").length,
      };
    });
    // The card carries its offset and nothing else: no custom property that
    // would invalidate style for the subtree behind it, no width, no scale.
    expect(snapshot.card).toMatch(/^transform: translate3d\(-?[\d.]+px, 0px, 0px\);?$/);
    // The staged page is moved and dimmed by class, so a frame of the gesture
    // never restyles it; the veil is the only thing on it that changes.
    expect(snapshot.staged).toBeNull();
    expect(snapshot.veil).toMatch(/^opacity: [\d.]+;?$/);
    expect(snapshot.stagedNodes).toBeGreaterThan(10);

    await touch.move(from.x - 7 * 24);
    await expect.poll(() => cardOffset(page)).toBeLessThan(-150);
    // Still nothing built under the finger.
    expect(await page.evaluate(() => document.querySelectorAll("*").length)).toBe(snapshot.allNodes);
    await touch.end();
    await touch.detach();
  });

  test("neighbouring screens are built while the app is idle, not during a swipe", async ({ page }) => {
    // The first swipe of a session used to create the next screen's DOM inside
    // the pointermove handler: 87 nodes built between the finger going down and
    // its first movement, a stall at the start of the gesture. The destinations
    // next to the current one now exist, hidden, before any swipe happens.
    await expect(screen(page, "lookup")).toHaveCount(1);
    await expect(screen(page, "lookup")).toHaveAttribute("hidden", "");
    // The one after that is not on either side of the start destination, so it
    // is still built on demand rather than at every idle moment.
    await expect(screen(page, "sorter")).toHaveCount(0);
    await expect(visibleScreen(page)).toHaveAttribute("data-screen", "generator");

    // Moving in makes the new neighbours warm too: both sides of "sorter".
    await nav(page, "sorter").click();
    await expect(title(page)).toHaveText("Card Sorter");
    await expect(screen(page, "lookup")).toHaveCount(1);
    await expect(screen(page, "settings")).toHaveCount(1);
    await expect(screen(page, "settings")).toHaveAttribute("hidden", "");
  });

  test("an interrupted drag leaves nothing behind, in either direction", async ({ page }) => {
    const from = await swipeSurface(page, -240);
    const touch = await openTouch(page, from);
    await touch.start();
    for (let step = 1; step <= 6; step += 1) await touch.move(from.x - step * 30);
    await expect.poll(() => cardOffset(page)).toBeLessThan(-120);
    // Turn around mid-gesture, back past where the finger started, and release
    // short of any commit distance.
    for (const x of [200, 260, from.x, 360, 370]) await touch.move(x);
    await touch.end();
    await touch.detach();
    await expect(title(page)).toHaveText("Generator");
    await expect(page.locator(".screen-host.stack-top")).toHaveCount(0);
    await expect(screen(page, "generator")).not.toHaveAttribute("style", /transform/);
    await expect(screen(page, "generator")).not.toHaveClass(/stack-(top|under|moving|settle)/);
    await expect(screen(page, "lookup")).toHaveAttribute("hidden", "");
    await expect(screen(page, "lookup")).not.toHaveClass(/stack-(top|under|moving|settle)/);

    // The same from the other side: a right drag that turns back.
    await nav(page, "lookup").click();
    await expect(title(page)).toHaveText("BIN Lookup");
    const right = await swipeSurface(page, 240);
    const back = await openTouch(page, right);
    await back.start();
    for (let step = 1; step <= 6; step += 1) await back.move(right.x + step * 20);
    await expect.poll(() => cardOffset(page)).toBeGreaterThan(60);
    for (const offset of [60, 20, -20, -40]) await back.move(right.x + offset);
    await back.end();
    await back.detach();
    await expect(title(page)).toHaveText("BIN Lookup");
    await expect(page.locator(".screen-host.stack-top")).toHaveCount(0);
    await expect(screen(page, "generator")).toHaveAttribute("hidden", "");
  });

  test("a vertical drag still scrolls, and never moves the card", async ({ page }) => {
    const scroller = () => page.evaluate(() => document.querySelector<HTMLElement>(".screen-host:not([hidden]) .screen-scroll")!.scrollTop);
    const before = await scroller();
    const from = await swipeSurface(page, 0);
    const touch = await openTouch(page, from);
    await touch.start();
    for (let step = 1; step <= 8; step += 1) await touch.move(from.x + step * 2, from.y - step * 30);
    await touch.end();
    await touch.detach();
    await expect(title(page)).toHaveText("Generator");
    expect(await scroller(), "the page scrolled").toBeGreaterThan(before);
    await expect(page.locator(".screen-host.stack-top")).toHaveCount(0);
  });

  test("Back during a drag cancels the swipe and navigates once", async ({ page }) => {
    await nav(page, "sorter").click();
    await expect(title(page)).toHaveText("Card Sorter");
    const from = await swipeSurface(page, -240);
    const touch = await openTouch(page, from);
    await touch.start();
    for (let step = 1; step <= 5; step += 1) await touch.move(from.x - step * 30);
    await expect.poll(() => cardOffset(page)).toBeLessThan(-100);
    // Android Back is Escape in the browser: both go through the same
    // dispatcher, and Back wins over an in-flight swipe.
    await page.keyboard.press("Escape");
    await expect(title(page)).toHaveText("Generator");
    await expect(page.locator(".screen-host.stack-top")).toHaveCount(0);
    await touch.end();
    await touch.detach();
    await page.waitForTimeout(400);
    await expect(title(page)).toHaveText("Generator");
  });

  test("the cost and pacing of a drag stay inside budget under CPU throttling", async ({ page }, testInfo) => {
    const cdp: CDPSession = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Performance.enable");
    const metrics = async () => {
      const { metrics: list } = await cdp.send("Performance.getMetrics");
      return Object.fromEntries(list.map((entry) => [entry.name, entry.value]));
    };
    const delta = (a: Record<string, number>, b: Record<string, number>, key: string) => (b[key] ?? 0) - (a[key] ?? 0);

    const moves = 24;
    const recalcPerMove: number[] = [];
    const taskPerMove: number[] = [];
    const dropped: number[] = [];
    const frameCounts: number[] = [];
    for (const direction of [-1, 1] as const) {
      await nav(page, direction === 1 ? "sorter" : "generator").click();
      await page.waitForTimeout(250);
      for (let run = 0; run < 3; run += 1) {
        await installDriver(page);
        const before = await metrics();
        const frames = await drive(page, direction, moves);
        const after = await metrics();
        recalcPerMove.push((delta(before, after, "RecalcStyleDuration") * 1000) / moves);
        taskPerMove.push((delta(before, after, "TaskDuration") * 1000) / moves);
        dropped.push(frames.filter((frame) => frame > 33).length);
        frameCounts.push(frames.length);
        await page.waitForTimeout(650);
      }
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const report = {
      label: "android-412x915-dsf2.625-throttle4",
      moves,
      drags: frameCounts.length,
      recalcMsPerMove: +median(recalcPerMove).toFixed(3),
      taskMsPerMove: +median(taskPerMove).toFixed(3),
      droppedFrames: dropped.reduce((total, value) => total + value, 0),
      frames: frameCounts.reduce((total, value) => total + value, 0),
    };
    console.log(`[swipe-performance] ${JSON.stringify(report)}`);
    testInfo.annotations.push({ type: "swipe-performance", description: JSON.stringify(report) });
    mkdirSync(dirname(METRICS_PATH), { recursive: true });
    appendFileSync(METRICS_PATH, `${JSON.stringify({ ...report, run: process.env.GITHUB_RUN_ID ?? null })}\n`);

    // Reference points on this harness (Chromium 153, 4x CPU throttle, the
    // production mobile bundle): the pre-fix drag loop cost 4.4 to 8.5 ms of
    // style recalculation per move and dropped 20 to 36 percent of frames; this
    // one costs about 1 ms per move and drops a few percent. The budget sits
    // well above the fixed numbers, so a slow runner cannot fail the build, and
    // well below the broken ones, so the regression cannot return unnoticed.
    expect(report.recalcMsPerMove).toBeLessThan(3);
    expect(report.droppedFrames / report.frames).toBeLessThan(0.25);
  });
});
