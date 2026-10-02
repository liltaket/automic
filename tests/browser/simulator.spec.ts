import { test, expect } from "@playwright/test";
test("direct question is shadow-only; third-person mentions and group questions stay muted", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Direct question", exact: true })
    .click();
  await expect(page.locator("#decision")).toHaveText("Your turn");
  await expect(page.locator("#action")).toHaveText("shadow");
  await expect(page.locator("#mic-status")).toHaveText("Mic muted");
  await page
    .getByRole("button", { name: "Name mentioned", exact: true })
    .click();
  await expect(page.locator("#decision")).toHaveText("Stay muted");
  await page
    .getByRole("button", { name: "Group question", exact: true })
    .click();
  await expect(page.locator("#mic-status")).toHaveText("Mic muted");
});
test("manual mic control, reset, custom captions, and no rules auto action", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Unmute manually", exact: true })
    .click();
  await expect(page.locator("#mic-status")).toHaveText("Mic open");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator("#mic-status")).toHaveText("Mic muted");
  await page.locator("#mode").selectOption("auto");
  await page.getByRole("button", { name: "Apply settings" }).click();
  await page.locator("#caption").fill("Bruno, what do you think?");
  await page.getByRole("button", { name: "Send caption" }).click();
  await expect(page.locator("#decision")).toHaveText("Your turn");
  await expect(page.locator("#mic-status")).toHaveText("Mic muted");
});
test("local-model failure stays muted and gives recovery; captions are text", async ({
  page,
}) => {
  await page.route("**/api/decide", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Start Ollaya and pull laya:multilingual.",
      }),
    }),
  );
  await page.goto("/");
  await page.locator("#backend").selectOption("ollaya");
  await page.getByRole("button", { name: "Apply settings" }).click();
  await page
    .locator("#caption")
    .fill("Bruno, what do you think? <img src=x onerror=alert(1)>");
  await page.getByRole("button", { name: "Send caption" }).click();
  await expect(page.locator("#action")).toHaveText("error");
  await expect(page.locator("#mic-status")).toHaveText("Mic muted");
  await expect(page.locator("#transcript img")).toHaveCount(0);
});
test("desktop and mobile have no horizontal overflow", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/simulator-${viewport.width}.png`,
      fullPage: true,
    });
  }
});
test("high-confidence local response opens only simulated mic; cancellation prevents action", async ({
  page,
}) => {
  await page.route("**/api/decide", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.model).toBe("laya:multilingual");
    expect(request.state.participant.name).toBe("Bruno Hjorth");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state_truncated: false,
        done_reason: "decide",
        answers: {
          turn: {
            type: "choice",
            choice: "UNMUTE",
            confidence: 0.99,
            probabilities: {
              UNMUTE: 0.99,
              STAY_MUTED: 0.005,
              UNCERTAIN: 0.005,
            },
          },
        },
      }),
    });
  });
  await page.goto("/");
  await page.locator("#backend").selectOption("ollaya");
  await page.locator("#mode").selectOption("auto");
  await page.getByRole("button", { name: "Apply settings" }).click();
  await page.locator("#caption").fill("Bruno, what do you think?");
  await page.getByRole("button", { name: "Send caption" }).click();
  await expect(page.locator("#notice-box")).toBeVisible();
  await page.getByRole("button", { name: "Cancel pending unmute" }).click();
  await page.waitForTimeout(1500);
  await expect(page.locator("#mic-status")).toHaveText("Mic muted");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.locator("#caption").fill("Bruno, what do you think?");
  await page.getByRole("button", { name: "Send caption" }).click();
  await expect(page.locator("#mic-status")).toHaveText("Mic open");
  await expect(page.locator("#action")).toHaveText("unmuted");
});
