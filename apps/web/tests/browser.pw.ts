import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

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
  await expect(
    page.getByText(
      /gate 1 — Fixture\/schema — passed — verification verification:gate:fixture-reference/,
    ),
  ).toBeVisible();
  await expect(page.locator("#evidence")).toHaveText(
    "evidence:wp6-fixture, verification:gate:fixture-reference",
  );
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("input, textarea, select, button")).toHaveCount(0);
  const connectionStatus = await page.locator("#connection-status").textContent();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator("#sse-observer-state")).toHaveAttribute(
    "data-duplicate-events-suppressed",
    "true",
  );

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
  const gateResults = await page.locator("#gate-results li").allTextContents();
  const evidenceReferences = await page.locator("#evidence").textContent();
  const geometryStatus = await page.locator("#geometry-status").textContent();
  const readOnlyControlCount = await page.locator("input, textarea, select, button").count();
  const sseState = page.locator("#sse-observer-state");
  const initialPosition = Number(await sseState.getAttribute("data-initial-position"));
  const receivedPositions = JSON.parse(
    (await sseState.getAttribute("data-received-positions")) ?? "[]",
  ) as number[];
  const duplicateEventsSuppressed =
    (await sseState.getAttribute("data-duplicate-events-suppressed")) === "true";
  const courtyard = geometryStatus?.match(/courtyard: ([^;]+)/)?.[1] ?? "unknown";
  const mask = geometryStatus?.match(/mask: ([^;]+)/)?.[1] ?? "unknown";
  await page.close();
  const reconnected = await page.context().newPage();
  await reconnected.goto("/");
  const reconnectedStatus = reconnected.locator("#connection-status");
  await expect(reconnectedStatus).toHaveText(/worker stopped; event position \d+/);
  await expect(reconnected.locator("body")).toHaveAttribute("data-worker-state", "stopped");
  const observedWorkerState = await reconnected.locator("body").getAttribute("data-worker-state");
  const workerStateAvailableAfterBrowserClose = observedWorkerState !== null;
  await reconnected.close();
  const evidence = {
    route: "/",
    headings,
    gateResults,
    evidenceReferences,
    accessibility: {
      connectionStatus,
      courtyard,
      mask,
    },
    readOnlyControlCount,
    geometry: projection,
    sse: {
      initialPosition,
      receivedPositions,
      cursorPosition: initialCursor,
      reconnectPosition: reconnectFrom,
      replayedPositions,
      duplicateEventsSuppressed,
      observedWorkerState,
      workerStateAvailableAfterBrowserClose,
    },
  };
  const bytes = canonical(evidence);
  if (process.env.ACD_UPDATE_BROWSER_EVIDENCE !== "1") {
    const committedBytes = await readFile(
      "../../artifacts/phase4/wp6-browser-semantic.json",
      "utf8",
    );
    const committedHash = await readFile(
      "../../artifacts/phase4/wp6-browser-semantic.sha256",
      "utf8",
    );
    expect(bytes + "\n").toBe(committedBytes);
    expect(createHash("sha256").update(`${bytes}\n`).digest("hex") + "\n").toBe(committedHash);
  }
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
  await expect(page.locator("#connection-status")).toHaveText(/worker stopped; event position \d+/);
  await page.close();
  const reconnected = await context.newPage();
  await reconnected.goto("/");
  await expect(reconnected.locator("#connection-status")).toHaveText(
    /worker stopped; event position \d+/,
  );
  await reconnected.close();
});
