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

  const projection = await (await page.request.get("/projection")).json();
  const initialEvents = await (await page.request.get("/events?from=0")).text();
  const initialPositions = [...initialEvents.matchAll(/^id: (\d+)$/gm)].map((match) =>
    Number(match[1]),
  );
  const initialCursor = Number(
    JSON.parse(initialEvents.match(/data: {"position":\d+}/)?.[0]?.slice(6) ?? '{"position":0}')
      .position,
  );
  const reconnectFrom = initialPositions.at(-1) ?? 0;
  const replayEvents = await (await page.request.get(`/events?from=${reconnectFrom}`)).text();
  const replayedPositions = [...replayEvents.matchAll(/^id: (\d+)$/gm)].map((match) =>
    Number(match[1]),
  );
  const headings = await page.locator("h1, h2").allTextContents();
  await page.close();
  const reconnected = await page.context().newPage();
  await reconnected.goto("/");
  await expect(reconnected.locator("#connection-status")).toContainText("worker connected");
  const browserCloseWorkerContinued = await reconnected
    .locator("#connection-status")
    .textContent()
    .then((text) => text?.startsWith("worker connected") ?? false);
  await reconnected.close();
  const evidence = {
    route: "/",
    headings,
    accessibility: {
      connectionStatus: "worker connected",
      courtyard: "unavailable",
      mask: "unavailable",
    },
    readOnlyControlCount: 0,
    geometry: projection,
    sse: {
      initialPosition: 0,
      receivedPositions: initialPositions,
      cursorPosition: initialCursor,
      reconnectPosition: reconnectFrom,
      replayedPositions,
      duplicateEventsSuppressed:
        new Set([...initialPositions, ...replayedPositions]).size ===
        initialPositions.length + replayedPositions.length - (replayedPositions.length > 0 ? 1 : 0),
      browserCloseWorkerContinued,
    },
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
  await expect(page.locator("#connection-status")).toHaveText(
    /worker connected; event position \d+/,
  );
  const initialPosition = await page.locator("#connection-status").textContent();
  await page.close();
  const reconnected = await context.newPage();
  await reconnected.goto("/");
  await expect(reconnected.locator("#connection-status")).toHaveText(
    /worker connected; event position \d+/,
  );
  await expect(reconnected.locator("#connection-status")).toContainText(
    initialPosition?.replace("worker connected; ", "") ?? "event position",
  );
  await reconnected.close();
});
