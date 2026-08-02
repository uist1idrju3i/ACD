import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignGraph } from "@acd/graph-core";

const uuid = "00000000-0000-4000-8000-000000000001";

export const renderBoard = (): string => `(kicad_pcb
  (version 20240108)
  (generator pcbnew)
  (general (thickness 1.6))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (36 "B.SilkS" user "b.silkscreen")
    (37 "F.SilkS" user "f.silkscreen")
    (44 "Edge.Cuts" user)
  )
  (setup (pad_to_mask_clearance 0))
  (gr_rect
    (start 10 10)
    (end 30 30)
    (stroke (width 0.05) (type default))
    (fill none)
    (layer "Edge.Cuts")
  )
)`;

export const renderSchematic = (): string => `(kicad_sch
  (version 20231120)
  (generator eeschema)
  (uuid ${uuid})
  (paper "A4")
  (lib_symbols)
  (sheet_instances
    (path "/" (page "1"))
  )
)`;

export const renderProject = (): string =>
  JSON.stringify(
    {
      board: {},
      boards: [],
      cvpcb: {},
      eeschema: {},
      libraries: {},
      meta: { filename: "design.kicad_pro", version: 1 },
      net_settings: {},
      pcbnew: {},
      schematics: [],
      text_variables: {},
    },
    null,
    2,
  );

export type KicadProjection = {
  directory: string;
  projectPath: string;
  schematicPath: string;
  boardPath: string;
};

export const projectToKicad = async (
  graph: DesignGraph,
  directory: string,
): Promise<KicadProjection> => {
  if (graph.project.type !== "Project") {
    throw new Error("graph project entity must have type Project");
  }
  await mkdir(directory, { recursive: true });
  const projectPath = join(directory, "design.kicad_pro");
  const schematicPath = join(directory, "design.kicad_sch");
  const boardPath = join(directory, "design.kicad_pcb");
  await writeFile(projectPath, renderProject(), "utf8");
  await writeFile(schematicPath, renderSchematic(), "utf8");
  await writeFile(boardPath, renderBoard(), "utf8");
  return { directory, projectPath, schematicPath, boardPath };
};
