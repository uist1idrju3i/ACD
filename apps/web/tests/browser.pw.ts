import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const canonical = (value: unknown): string => JSON.stringify(value, null, 2);

test("read-only run observer renders state and projection", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ACD Run Observer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Task ledger" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gate results" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stop record" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Checkpoints" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence references" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "2D projection" })).toBeVisible();
  await expect(page.getByText(/courtyard: unavailable/)).toBeVisible();
  await expect(page.getByText(/mask: unavailable/)).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("input, textarea, select, button")).toHaveCount(0);

  const evidence = {
    route: "/",
    headings: await page.locator("h1, h2").allTextContents(),
    readOnlyControlCount: await page.locator("input, textarea, select, button").count(),
    geometryStatus: await page.locator("#geometry-status").textContent(),
    connectionStatus: await page.locator("#connection-status").textContent(),
  };
  const bytes = canonical(evidence);
  await mkdir("../../artifacts/phase4", { recursive: true });
  await writeFile("../../artifacts/phase4/wp6-browser-semantic.json", `${bytes}\n`, "utf8");
  await writeFile(
    "../../artifacts/phase4/wp6-browser-semantic.sha256",
    `${createHash("sha256").update(`${bytes}\n`).digest("hex")}\n`,
    "utf8",
  );
});

test("event stream exposes a reconnect cursor", async ({ page, request }) => {
  await page.goto("/");
  const response = await request.get("/events?from=0");
  expect(response.ok()).toBeTruthy();
  const body = await response.text();
  expect(body).toContain("event: cursor");
  expect(body).toContain("id: 0");
});

test("browser close and reconnect keeps the worker state available", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator("#connection-status")).toContainText("worker connected");
  const initialPosition = await page.locator("#connection-status").textContent();
  await page.close();
  const reconnected = await context.newPage();
  await reconnected.goto("/");
  await expect(reconnected.locator("#connection-status")).toContainText("worker connected");
  await expect(reconnected.locator("#connection-status")).toContainText(
    initialPosition?.replace("worker connected; ", "") ?? "event position",
  );
  await reconnected.close();
});
