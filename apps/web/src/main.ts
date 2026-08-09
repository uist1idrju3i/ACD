import "./style.css";

type Projection = {
  unit: "mm";
  revision: number;
  outline: { originMm: { xMm: number; yMm: number }; widthMm: number; heightMm: number };
  pads: Array<{
    positionMm: { xMm: number; yMm: number };
    widthMm: number;
    heightMm: number;
    layer: string;
  }>;
  tracks: Array<{
    startMm: { xMm: number; yMm: number };
    endMm: { xMm: number; yMm: number };
    widthMm: number;
    layer: string;
  }>;
  vias: Array<{ atMm: { xMm: number; yMm: number }; diameterMm: number }>;
  courtyard: { status: "unavailable" };
  mask: { status: "unavailable" };
};

type WorkerState = {
  eventPosition: number;
  revision: number;
  taskLedger: { entries: Record<string, { id: string; status: string; attemptCount: number }> };
  gateResults: Array<{ id?: string; gate?: string; status?: string }>;
  stopRecord: { reasonCode?: string; evidenceIds?: string[] } | null;
  checkpoints: unknown[];
  evidenceIds: string[];
};

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("app root is missing");

const statusClass = (status: string): string =>
  ["passed", "failed", "blocked", "stale", "unknown", "unverified"].includes(status)
    ? status
    : "unverified";

const fetchJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`worker request failed: ${response.status}`);
  return (await response.json()) as T;
};

const drawProjection = (canvas: HTMLCanvasElement, projection: Projection): void => {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas2D is unavailable");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  const scale = Math.min(
    (width - 40) / projection.outline.widthMm,
    (height - 40) / projection.outline.heightMm,
  );
  const x = (value: number): number => 20 + (value - projection.outline.originMm.xMm) * scale;
  const y = (value: number): number => 20 + (value - projection.outline.originMm.yMm) * scale;
  context.strokeStyle = "#64748b";
  context.strokeRect(
    20,
    20,
    projection.outline.widthMm * scale,
    projection.outline.heightMm * scale,
  );
  context.lineWidth = 1;
  for (const track of projection.tracks) {
    context.strokeStyle = track.layer === "B.Cu" ? "#2563eb" : "#dc2626";
    context.lineWidth = Math.max(1, track.widthMm * scale);
    context.beginPath();
    context.moveTo(x(track.startMm.xMm), y(track.startMm.yMm));
    context.lineTo(x(track.endMm.xMm), y(track.endMm.yMm));
    context.stroke();
  }
  for (const pad of projection.pads) {
    context.fillStyle = "#f59e0b";
    context.fillRect(
      x(pad.positionMm.xMm) - (pad.widthMm * scale) / 2,
      y(pad.positionMm.yMm) - (pad.heightMm * scale) / 2,
      pad.widthMm * scale,
      pad.heightMm * scale,
    );
  }
  for (const via of projection.vias) {
    context.strokeStyle = "#7c3aed";
    context.beginPath();
    context.arc(
      x(via.atMm.xMm),
      y(via.atMm.yMm),
      Math.max(1, (via.diameterMm * scale) / 2),
      0,
      Math.PI * 2,
    );
    context.stroke();
  }
};

const render = async (): Promise<void> => {
  root.innerHTML = `
    <h1>ACD Run Observer</h1>
    <p id="connection-status" class="unknown">worker state: loading</p>
    <section aria-labelledby="ledger-heading">
      <h2 id="ledger-heading">Task ledger</h2>
      <ul id="task-ledger"></ul>
    </section>
    <section aria-labelledby="gate-heading">
      <h2 id="gate-heading">Gate results</h2>
      <ul id="gate-results"></ul>
    </section>
    <section aria-labelledby="stop-heading">
      <h2 id="stop-heading">Stop record</h2>
      <p id="stop-record">none</p>
    </section>
    <section aria-labelledby="checkpoint-heading">
      <h2 id="checkpoint-heading">Checkpoints</h2>
      <p id="checkpoints"></p>
    </section>
    <section aria-labelledby="evidence-heading">
      <h2 id="evidence-heading">Evidence references</h2>
      <p id="evidence"></p>
    </section>
    <section aria-labelledby="projection-heading">
      <h2 id="projection-heading">2D projection</h2>
      <p id="geometry-status"></p>
      <canvas id="board" width="640" height="420" aria-label="ACD board projection"></canvas>
    </section>
  `;
  const state = await fetchJson<WorkerState>("/state");
  const projection = await fetchJson<Projection>("/projection");
  const connection = document.querySelector<HTMLParagraphElement>("#connection-status");
  if (!connection) throw new Error("connection status missing");
  connection.textContent = `worker connected; event position ${state.eventPosition}`;
  connection.className = "passed";
  const ledger = document.querySelector<HTMLUListElement>("#task-ledger");
  if (!ledger) throw new Error("task ledger missing");
  ledger.replaceChildren(
    ...Object.values(state.taskLedger.entries).map((entry) => {
      const item = document.createElement("li");
      item.textContent = `${entry.id} — ${entry.status} — attempt ${entry.attemptCount}`;
      item.dataset.taskId = entry.id;
      item.dataset.status = statusClass(entry.status);
      return item;
    }),
  );
  const gates = document.querySelector<HTMLUListElement>("#gate-results");
  if (!gates) throw new Error("gate results missing");
  gates.replaceChildren(
    ...state.gateResults.map((gate) => {
      const item = document.createElement("li");
      const status = statusClass(gate.status ?? "unverified");
      item.textContent = `${gate.gate ?? "unknown gate"} — ${status} — verification ${gate.id ?? "missing"}`;
      item.dataset.status = status;
      item.dataset.verificationResultId = gate.id ?? "";
      return item;
    }),
  );
  const stop = document.querySelector<HTMLParagraphElement>("#stop-record");
  if (!stop) throw new Error("stop record missing");
  stop.textContent = state.stopRecord
    ? `${state.stopRecord.reasonCode ?? "unknown"} — evidence ${state.stopRecord.evidenceIds?.join(", ") ?? "missing"}`
    : "none";
  const checkpoints = document.querySelector<HTMLParagraphElement>("#checkpoints");
  if (!checkpoints) throw new Error("checkpoint display missing");
  checkpoints.textContent = `${state.checkpoints.length} checkpoint(s)`;
  const evidence = document.querySelector<HTMLParagraphElement>("#evidence");
  if (!evidence) throw new Error("evidence display missing");
  evidence.textContent = state.evidenceIds.length > 0 ? state.evidenceIds.join(", ") : "none";
  const geometry = document.querySelector<HTMLParagraphElement>("#geometry-status");
  if (!geometry) throw new Error("geometry status missing");
  geometry.textContent = `unit: ${projection.unit}; revision: ${projection.revision}; courtyard: ${projection.courtyard.status}; mask: ${projection.mask.status}`;
  const canvas = document.querySelector<HTMLCanvasElement>("#board");
  if (!canvas) throw new Error("board canvas missing");
  drawProjection(canvas, projection);
};

const reconnect = (): void => {
  let position = 0;
  const events = new EventSource(`/events?from=${position}`);
  events.addEventListener("cursor", (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as { position: number };
    position = payload.position;
  });
  events.onmessage = () => {
    void render();
  };
};

void render().then(reconnect);
window.addEventListener("offline", () => {
  const connection = document.querySelector<HTMLParagraphElement>("#connection-status");
  if (connection) {
    connection.textContent = "browser disconnected; worker may continue";
    connection.className = "unknown";
  }
});
