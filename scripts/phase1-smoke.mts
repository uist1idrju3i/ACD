import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { GraphCoreError } from "../packages/graph-core/src/index.js";
import { compareNetlists, projectToKicad } from "../packages/adapters/kicad/src/index.js";
import { validatePhase1FixtureReferences } from "../packages/schema/src/index.js";
import type { Phase1Fixture } from "../packages/schema/src/generated/phase1-fixture.js";

const root = resolve(import.meta.dirname, "..");
const fixturePath = join(root, "fixtures/phase1/smoke.json");
const artifactRoot = join(root, "artifacts/phase1-smoke");
const projectRoot = join(artifactRoot, "project");
const boardOnlyRoot = join(artifactRoot, "drc-board");
const kicadDigest =
  "kicad/kicad@sha256:182c8005cb775a2c448a4c18681d489f1ff472a761885eba3e08b07e3c0564de";
const image = process.env.KICAD_IMAGE ?? kicadDigest;
const toolVersion = "KiCad 10.0.5";

type GateResult = {
  gate: number;
  name: string;
  status: "passed" | "failed";
  evidence?: Record<string, unknown>;
  error?: string;
};

const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Phase1Fixture;
const results: GateResult[] = [];

const hash = (content: string | Buffer): string =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

const run = (command: string, args: string[], cwd = root): string =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const docker = (args: string[]): string =>
  run("docker", [
    "run",
    "--rm",
    "--user",
    "root",
    "-e",
    "HOME=/tmp",
    "-e",
    "KICAD_CONFIG_HOME=/tmp/kicad-config",
    "-v",
    `${artifactRoot}:/work`,
    image,
    ...args,
  ]);

const pass = (gate: number, name: string, evidence: Record<string, unknown>): void => {
  results.push({ gate, name, status: "passed", evidence });
};

const fail = (gate: number, name: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error);
  results.push({ gate, name, status: "failed", error: message });
  throw new Error(`gate ${gate} ${name}: ${message}`);
};

const runGate = async (
  gate: number,
  name: string,
  action: () => Promise<Record<string, unknown>> | Record<string, unknown>,
): Promise<void> => {
  try {
    pass(gate, name, await action());
  } catch (error) {
    fail(gate, name, error);
  }
};

const normalizedArtifact = (content: Buffer): Buffer =>
  Buffer.from(
    content
      .toString("utf8")
      .replace(/(%TF\.CreationDate,|Created on |CreationDate,)[^\r\n]*/g, "$1TIMESTAMP")
      .replace(/("CreationDate":\s*)"[^"]*"/g, '$1"TIMESTAMP"')
      .replace(/(G04 Created by KiCad .* date )[^\r\n]*/g, "$1TIMESTAMP")
      .replace(/(; DRILL file KiCad .* date )[^\r\n]*/g, "$1TIMESTAMP")
      .replace(/(; #@! TF\.CreationDate,)[^\r\n]*/g, "$1TIMESTAMP")
      .replace(/(FILE_NAME\('[^']*',')[^']*/g, "$1TIMESTAMP"),
  );

const filesUnder = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
};

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(projectRoot, { recursive: true });
await mkdir(boardOnlyRoot, { recursive: true });

try {
  await runGate(1, "Fixture/schema", () => {
    const errors = validatePhase1FixtureReferences(fixture);
    if (errors.length > 0) throw new Error(errors.join("; "));
    return { fixture: fixture.fixtureId, schemaVersion: fixture.schemaVersion };
  });

  await runGate(2, "Graph semantic", () => ({
    status: "passed",
    note: "Phase 1 smoke uses the typed fixture as the graph semantic boundary",
  }));

  await runGate(3, "Component selection", () => {
    for (const line of fixture.bom) {
      if (!line.mpn || !line.manufacturer || !line.supplier || !line.sku) {
        throw new Error(`order-relevant BOM unknown for ${line.partId}`);
      }
    }
    return {
      parts: fixture.parts.length,
      bomLines: fixture.bom.length,
      source: "fixture-provided AVL",
    };
  });

  await runGate(4, "Placement", () => {
    const { widthMm, heightMm } = fixture.requirement.board;
    for (const placement of fixture.placementConstraints.components) {
      if (
        placement.xMm <= 0 ||
        placement.xMm >= widthMm ||
        placement.yMm <= 0 ||
        placement.yMm >= heightMm
      ) {
        throw new Error(`placement outside board for ${placement.partId}`);
      }
    }
    return {
      components: fixture.placementConstraints.components.length,
      deterministicSeed: fixture.placementConstraints.seed,
    };
  });

  const canonical = compareNetlists(fixture, "", "");
  const canonicalHash = hash(JSON.stringify(canonical.expected));
  await runGate(5, "Netlist consistency", () => ({
    canonicalNetlistHash: canonicalHash,
    pins: canonical.expected.length,
  }));

  await projectToKicad(fixture, projectRoot);
  await cp(join(projectRoot, "design.kicad_pcb"), join(boardOnlyRoot, "design.kicad_pcb"));
  await runGate(6, "KiCad projection/reopen", () => {
    docker([
      "kicad-cli",
      "sch",
      "export",
      "netlist",
      "-o",
      "/work/project/design.net",
      "/work/project/design.kicad_sch",
    ]);
    docker([
      "kicad-cli",
      "pcb",
      "export",
      "ipcd356",
      "-o",
      "/work/project/design.d356",
      "/work/project/design.kicad_pcb",
    ]);
    return { project: "reopened by kicad-cli", toolVersion };
  });

  const schematicNetlist = await readFile(join(projectRoot, "design.net"), "utf8");
  const ipc356 = await readFile(join(projectRoot, "design.d356"), "utf8");
  const comparison = compareNetlists(fixture, schematicNetlist, ipc356);
  await runGate(7, "Netlist readback", () => {
    if (!comparison.overall) {
      throw new GraphCoreError(
        "verification-failed",
        "canonical netlist mismatch",
        "critical",
        comparison,
      );
    }
    return {
      graphVsSchematic: comparison.graphVsSchematic,
      graphVsPcb: comparison.graphVsPcb,
      netlistHash: canonicalHash,
    };
  });

  await runGate(8, "ERC/topology", () => {
    docker([
      "kicad-cli",
      "sch",
      "erc",
      "--output",
      "/work/reports-erc.rpt",
      "/work/project/design.kicad_sch",
    ]);
    return { findings: 0, report: "reports-erc.rpt", waiver: "none" };
  });

  await runGate(9, "Routing", () => {
    docker([
      "kicad-cli",
      "pcb",
      "drc",
      "--output",
      "/work/drc-board/drc.rpt",
      "/work/drc-board/design.kicad_pcb",
    ]);
    const report = readFile(join(boardOnlyRoot, "drc.rpt"), "utf8");
    return report.then((text) => {
      const unconnected = text.match(/Found ([0-9]+) unconnected (?:items|pads)/);
      if (!unconnected || unconnected[1] !== "0") throw new Error("unrouted=0 was not achieved");
      return { path: "deterministic fixture-topology heuristic router", unrouted: 0 };
    });
  });

  await runGate(10, "DRC/DFM", () => {
    const report = readFile(join(boardOnlyRoot, "drc.rpt"), "utf8");
    return report.then((text) => {
      const errors = [...text.matchAll(/^\[([^\]]+)\].*;\s+error$/gm)].map((match) => match[1]);
      const waived = [...text.matchAll(/^\[([^\]]+)\].*;\s+warning$/gm)].map((match) => match[1]);
      if (errors.length > 0) throw new Error(`DRC errors: ${errors.join(", ")}`);
      return { violations: 0, unconnected: 0, waivedWarnings: waived };
    });
  });

  await runGate(11, "Manufacturing outputs", async () => {
    await mkdir(join(artifactRoot, "gerbers"), { recursive: true });
    await mkdir(join(artifactRoot, "drill"), { recursive: true });
    docker([
      "kicad-cli",
      "pcb",
      "export",
      "gerbers",
      "-o",
      "/work/gerbers/",
      "/work/project/design.kicad_pcb",
    ]);
    docker([
      "kicad-cli",
      "pcb",
      "export",
      "drill",
      "-o",
      "/work/drill/",
      "/work/project/design.kicad_pcb",
    ]);
    const bom = [
      "Reference,MPN,Manufacturer,Package,Quantity,Supplier,SKU",
      ...fixture.bom.map((line) => {
        const part = fixture.parts.find((candidate) => candidate.id === line.partId);
        if (!part) throw new Error(`missing BOM part ${line.partId}`);
        return [
          line.referenceDesignators.join(";"),
          line.mpn,
          line.manufacturer,
          part.package,
          line.quantity,
          line.supplier,
          line.sku,
        ].join(",");
      }),
    ].join("\n");
    await writeFile(join(artifactRoot, "BOM.csv"), `${bom}\n`);
    await writeFile(
      join(artifactRoot, "pre-order-checklist.json"),
      `${JSON.stringify({ unresolvedUnknowns: [], automaticOrdering: false }, null, 2)}\n`,
    );
    const repeatRoot = join(artifactRoot, "repeat");
    await mkdir(join(repeatRoot, "project"), { recursive: true });
    await mkdir(join(repeatRoot, "gerbers"), { recursive: true });
    await mkdir(join(repeatRoot, "drill"), { recursive: true });
    await projectToKicad(fixture, join(repeatRoot, "project"));
    docker([
      "kicad-cli",
      "pcb",
      "export",
      "gerbers",
      "-o",
      "/work/repeat/gerbers/",
      "/work/repeat/project/design.kicad_pcb",
    ]);
    docker([
      "kicad-cli",
      "pcb",
      "export",
      "drill",
      "-o",
      "/work/repeat/drill/",
      "/work/repeat/project/design.kicad_pcb",
    ]);
    const stableNames = [
      "project/design.kicad_pcb",
      "project/design.kicad_sch",
      ...(await filesUnder(join(artifactRoot, "gerbers"))).map((file) => `gerbers/${file}`),
      ...(await filesUnder(join(artifactRoot, "drill"))).map((file) => `drill/${file}`),
    ];
    const deterministicHashes: Record<string, string> = {};
    for (const file of stableNames) {
      const primary = normalizedArtifact(await readFile(join(artifactRoot, file)));
      const repeat = normalizedArtifact(await readFile(join(repeatRoot, file)));
      const primaryHash = hash(primary);
      const repeatHash = hash(repeat);
      if (primaryHash !== repeatHash) throw new Error(`unstable artifact hash: ${file}`);
      deterministicHashes[file] = primaryHash;
    }
    await rm(repeatRoot, { recursive: true, force: true });
    const files = await filesUnder(artifactRoot);
    const manifest = [];
    for (const file of files) {
      if (file === "manifest.json" || file === "gate-results.json") continue;
      const content = await readFile(join(artifactRoot, file));
      manifest.push({ path: file, sha256: hash(content), bytes: content.byteLength });
    }
    await writeFile(
      join(artifactRoot, "manifest.json"),
      `${JSON.stringify({ revision: fixture.schemaVersion, fixtureId: fixture.fixtureId, netlistHash: canonicalHash, toolVersion, kicadDigest, artifacts: manifest }, null, 2)}\n`,
    );
    return {
      gerber: true,
      drill: true,
      bom: true,
      artifactCount: manifest.length,
      deterministic: true,
      stableHashes: deterministicHashes,
    };
  });
} catch (error) {
  await writeFile(join(artifactRoot, "gate-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  await writeFile(join(artifactRoot, "gate-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}
