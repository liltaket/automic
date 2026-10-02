import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
} from "@playwright/test";
import { resolve } from "node:path";
import { DEFAULT_SETTINGS } from "../../core/types";
let context: BrowserContext;
let worker: Worker;
test.beforeEach(async () => {
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${resolve("dist/extension")}`,
      `--load-extension=${resolve("dist/extension")}`,
    ],
  });
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
});
test.afterEach(async () => {
  await context?.close();
});
const markup = `<!doctype html><html><body><button aria-label="Leave call">Leave</button><button id="mic" aria-label="Turn on microphone">Mic</button><section aria-label="Live captions" role="log" id="captions"></section><script>document.getElementById('mic').onclick=()=>{const b=document.getElementById('mic');b.setAttribute('aria-label',b.getAttribute('aria-label')==='Turn on microphone'?'Turn off microphone':'Turn on microphone');};</script></body></html>`;
async function meeting() {
  await context.route("https://meet.google.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: markup }),
  );
  const page = await context.newPage();
  await page.goto("https://meet.google.com/abc-defg-hij");
  await expect(page.locator("#automic-extension-host")).toBeVisible();
  return page;
}
test("packaged MV3 extension reads new Meet fixture captions in shadow without clicking mic", async () => {
  await worker.evaluate(
    async (settings) => {
      await chrome.storage.local.set({ "automic.settings": settings });
    },
    {
      ...DEFAULT_SETTINGS,
      name: "Bruno Hjorth",
      aliases: ["Bruno"],
      backend: "rules",
      debug: true,
    },
  );
  const page = await meeting();
  await page.evaluate(() => {
    const row = document.createElement("div");
    row.setAttribute("data-caption", "");
    row.innerHTML =
      '<span data-speaker="Anna">Anna</span><span data-caption-text>Bruno, what do you think?</span>';
    document.getElementById("captions")!.append(row);
  });
  await expect(page.locator("#automic-extension-host")).toContainText("UNMUTE");
  await expect(page.locator("#mic")).toHaveAttribute(
    "aria-label",
    "Turn on microphone",
  );
});
test("packaged extension applies guarded auto action to fixture with mocked model, then never mutes", async () => {
  await worker.evaluate(
    async (settings) => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            state_truncated: false,
            done_reason: "decide",
            answers: {
              turn: {
                type: "choice",
                choice: "UNMUTE",
                probabilities: {
                  UNMUTE: 0.99,
                  STAY_MUTED: 0.005,
                  UNCERTAIN: 0.005,
                },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      await chrome.storage.local.set({ "automic.settings": settings });
    },
    {
      ...DEFAULT_SETTINGS,
      name: "Bruno Hjorth",
      aliases: ["Bruno"],
      mode: "auto",
      debug: true,
      notifyBeforeUnmute: false,
    },
  );
  const page = await meeting();
  await page.evaluate(() => {
    const row = document.createElement("div");
    row.setAttribute("data-caption", "");
    row.innerHTML =
      '<span data-speaker="Anna">Anna</span><span data-caption-text>Bruno, what do you think?</span>';
    document.getElementById("captions")!.append(row);
  });
  await expect(page.locator("#mic")).toHaveAttribute(
    "aria-label",
    "Turn off microphone",
  );
  await page.evaluate(() => {
    document.querySelector("[data-caption-text]")!.textContent =
      "Bruno, can you explain more?";
  });
  await page.waitForTimeout(400);
  await expect(page.locator("#mic")).toHaveAttribute(
    "aria-label",
    "Turn off microphone",
  );
});
test("newer caption cancels delayed inference before a real fixture action", async () => {
  await worker.evaluate(
    async (settings) => {
      globalThis.fetch = async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return new Response(
          JSON.stringify({
            state_truncated: false,
            done_reason: "decide",
            answers: {
              turn: {
                type: "choice",
                probabilities: {
                  UNMUTE: 0.99,
                  STAY_MUTED: 0.005,
                  UNCERTAIN: 0.005,
                },
              },
            },
          }),
          { status: 200 },
        );
      };
      await chrome.storage.local.set({ "automic.settings": settings });
    },
    {
      ...DEFAULT_SETTINGS,
      name: "Bruno Hjorth",
      aliases: ["Bruno"],
      mode: "auto",
      debug: true,
      notifyBeforeUnmute: false,
    },
  );
  const page = await meeting();
  await page.evaluate(() => {
    const row = document.createElement("div");
    row.setAttribute("data-caption", "");
    row.innerHTML =
      '<span data-speaker="Anna">Anna</span><span data-caption-text>Bruno, what do you think?</span>';
    document.getElementById("captions")!.append(row);
  });
  await page.waitForTimeout(220);
  await page.evaluate(() => {
    const row = document.createElement("div");
    row.setAttribute("data-caption", "");
    row.innerHTML =
      '<span data-speaker="Anna">Anna</span><span data-caption-text>Bruno, do not speak yet.</span>';
    document.getElementById("captions")!.append(row);
  });
  await page.waitForTimeout(1200);
  await expect(page.locator("#mic")).toHaveAttribute(
    "aria-label",
    "Turn on microphone",
  );
});
