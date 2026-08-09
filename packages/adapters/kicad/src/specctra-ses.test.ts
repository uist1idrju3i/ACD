import { describe, expect, it } from "vitest";
import { KicadProjectionError } from "./errors.js";
import { parseSpecctraSes } from "./specctra-ses.js";

const ses = (overrides = "") => `(session golden
  (routes
    (resolution um 10)
    (library_out
      (padstack "Via[0-1]_800:400_um"
        (shape
          (circle F.Cu 8000 0 0)
        )
        (shape
          (circle B.Cu 8000 0 0)
        )
      )
    )
    (network_out
      (net "N1"
        (wire
          (path F.Cu 2500
            20000 -20000
            10000 -10000
            30000 -10000
          )
        )
        (via "Via[0-1]_800:400_um" 20000 -20000)
      )
      ${overrides}
    )
  )
)`;

describe("parseSpecctraSes", () => {
  it("converts paths into canonical tracks and preserves provenance", () => {
    const result = parseSpecctraSes(ses(), (name) => name);
    expect(result.tracks).toEqual([
      {
        netId: "N1",
        layer: "F.Cu",
        widthMm: 0.25,
        startMm: { xMm: 1, yMm: 1 },
        endMm: { xMm: 3, yMm: 1 },
      },
      {
        netId: "N1",
        layer: "F.Cu",
        widthMm: 0.25,
        startMm: { xMm: 2, yMm: 2 },
        endMm: { xMm: 1, yMm: 1 },
      },
    ]);
    expect(result.vias[0]).toMatchObject({
      netId: "N1",
      atMm: { xMm: 2, yMm: 2 },
      diameterMm: 0.8,
      drillMm: 0.4,
      layers: ["B.Cu", "F.Cu"],
    });
    expect(result.provenance.resolution).toBe(10);
    expect(result.provenance.rawTracks[0]?.points).toEqual([
      { x: 20000, y: -20000 },
      { x: 10000, y: -10000 },
      { x: 30000, y: -10000 },
    ]);
  });

  it("stops on unsupported resolution, layer, padstack, and unresolved net", () => {
    expect(() =>
      parseSpecctraSes(ses().replace("(resolution um 10)", "(resolution mil 10)"), () => "N1"),
    ).toThrow(KicadProjectionError);
    expect(() => parseSpecctraSes(ses().replace("path F.Cu", "path In1.Cu"), () => "N1")).toThrow(
      KicadProjectionError,
    );
    expect(() =>
      parseSpecctraSes(ses().replace("Via[0-1]_800:400_um", "unknown"), () => "N1"),
    ).toThrow(KicadProjectionError);
    expect(() => parseSpecctraSes(ses(), () => "")).toThrow(KicadProjectionError);
  });

  it("stops on duplicate net names and incomplete paths", () => {
    expect(() =>
      parseSpecctraSes(
        ses(`(net "N1" (wire (path F.Cu 2500 10000 -10000 20000)))`),
        (name) => name,
      ),
    ).toThrow(KicadProjectionError);
    expect(() =>
      parseSpecctraSes(
        ses().replace("20000 -20000\n            10000 -10000", "20000 -20000\n            10000"),
        (name) => name,
      ),
    ).toThrow(KicadProjectionError);
  });
});
