/**
 * UI screenshot harness — repeatable, CI-friendly panel captures.
 *
 * Boots the Vite dev server in-process, drives a headless Chromium via
 * Playwright, seeds each panel through the dev-only `window.__uiStore` bridge
 * (the SAME seam the live Phaser game uses), waits for the panel to render, and
 * writes one PNG per panel into a git-ignored artifacts dir.
 *
 * It reuses the shared fixtures in src/ui/__fixtures__/snapshots.ts, so the
 * captured panels match exactly what the Vitest suite renders.
 *
 * Run it:
 *     pnpm --filter @maple/client ui:screenshots
 *
 * Exit code is non-zero if any panel logs a console error or fails to render,
 * making it usable as a verify-step in CI.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";

import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type ConsoleMessage } from "playwright";

import { panelFixtures, type StoreSeed } from "../src/ui/__fixtures__/snapshots";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, "..");
const outDir = resolve(clientRoot, "artifacts/ui-screenshots");

/** Console messages that are expected dev-server noise, not real failures. */
const IGNORE_CONSOLE = [
  /favicon/i,
  /\[vite\]/i,
  /Download the React DevTools/i,
  /WebGL/i,
  // Phaser's WebGL framebuffer errors when its canvas is hidden (#game { display:
  // none }) so captures show only the React overlay — expected, not a panel bug.
  /Framebuffer status/i,
];

async function startDevServer(): Promise<ViteDevServer> {
  const server = await createServer({
    root: clientRoot,
    configFile: resolve(clientRoot, "vite.config.ts"),
    logLevel: "error",
    server: { port: 0 },
  });
  await server.listen();
  return server;
}

function resolvedUrl(server: ViteDevServer): string {
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("Vite dev server did not report a local URL");
  return url;
}

async function main(): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const server = await startDevServer();
  const url = resolvedUrl(server);
  let browser: Browser | undefined;
  const failures: string[] = [];

  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });

    for (const fixture of panelFixtures) {
      const page = await context.newPage();
      const errors: string[] = [];

      page.on("console", (msg: ConsoleMessage) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (IGNORE_CONSOLE.some((re) => re.test(text))) return;
        errors.push(text);
      });
      page.on("pageerror", (err: Error) => {
        const text = err.message;
        if (IGNORE_CONSOLE.some((re) => re.test(text))) return;
        errors.push(text);
      });

      await page.goto(url, { waitUntil: "load" });

      // Wait for the React overlay bridge store to be exposed (dev-only).
      await page.waitForFunction(() => "__uiStore" in window, undefined, {
        timeout: 15_000,
      });

      // A fresh Playwright context has no token, so Phaser boots into the Login
      // gate and opens that panel (or, with a persisted session, CharacterCreate).
      // Wait for whichever boot panel opens so we seed AFTER Phaser has finished
      // opening its own panels — otherwise the scene re-opens it over our seed.
      await page
        .waitForFunction(
          () => {
            const s = (
              window as unknown as {
                __uiStore: { getState: () => Record<string, unknown> };
              }
            ).__uiStore.getState();
            return s.loginOpen === true || s.characterCreateOpen === true;
          },
          undefined,
          { timeout: 15_000 },
        )
        .catch(() => {
          /* No boot gate (e.g. persisted charId) — proceed. */
        });

      // Hide the Phaser canvas so captures show the panel cleanly. Use opacity
      // (not display:none) so the WebGL context stays alive — display:none
      // triggers spurious "Framebuffer status: Incomplete Attachment" errors.
      await page.addStyleTag({
        content: "#game { opacity: 0 !important; pointer-events: none !important; }",
      });

      // Seed the panel through the bridge store, exactly like Phaser would.
      await page.evaluate((seeds: StoreSeed[]) => {
        const store = (
          window as unknown as {
            __uiStore: {
              getState: () => Record<string, unknown>;
              setState: (partial: Record<string, unknown>) => void;
            };
          }
        ).__uiStore;
        const state = store.getState();
        // Start from a clean slate: the live Phaser scenes may have opened their
        // own panels (e.g. CharacterCreate). Force every `*Open` flag false
        // directly via the vanilla store's setState (slice setters aren't named
        // consistently), then apply the fixture's own setters.
        const closed: Record<string, unknown> = {};
        for (const key of Object.keys(state)) {
          if (key.endsWith("Open") && typeof state[key] === "boolean") {
            closed[key] = false;
          }
        }
        store.setState(closed);
        for (const { method, args } of seeds) {
          const fn = store.getState()[method];
          if (typeof fn !== "function") {
            throw new Error(`Unknown store setter: ${method}`);
          }
          (fn as (...a: unknown[]) => void)(...args);
        }
      }, fixture.seed);

      try {
        await page.waitForSelector(fixture.ready, { timeout: 10_000 });
      } catch {
        failures.push(`${fixture.id}: panel never rendered (${fixture.ready})`);
        await page.close();
        continue;
      }

      // Settle a frame so fonts/layout flush before the shot.
      await page.waitForTimeout(150);

      const file = resolve(outDir, `${fixture.id}.png`);
      await page.screenshot({ path: file });

      if (errors.length > 0) {
        failures.push(
          `${fixture.id}: ${errors.length} console error(s):\n    ${errors.join("\n    ")}`,
        );
      }

      console.log(`✓ ${fixture.label.padEnd(14)} → ${file}`);
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} panel(s) failed:\n${failures.join("\n")}`);
    process.exit(1);
  }

  console.log(`\nAll ${panelFixtures.length} panel(s) captured into ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
