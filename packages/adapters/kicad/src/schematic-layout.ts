import type { Phase1Fixture } from "@acd/schema";
import { KicadProjectionError } from "./errors.js";

/**
 * Readability-only schematic layout. The layout groups symbols by the functional block the
 * design rationale assigns them to, so the sheet reads block by block instead of following
 * board placement order. It changes geometry and annotation only: net membership, symbol
 * identity and pin names are untouched, so the netlist and ERC results do not move.
 */
export type SchematicBlock = {
  block: string;
  title: string;
  partIds: string[];
};

export type BlockAnnotation = {
  text: string;
  xMm: number;
  yMm: number;
};

export type SchematicLayout = {
  origins: Map<string, [number, number]>;
  annotations: BlockAnnotation[];
  blocks: SchematicBlock[];
};

const gridMm = 1.27;
const originXMm = 25.4;
const originYMm = 38.1;
const symbolGapMm = 10.16;
const columnGapMm = 20.32;
const blockGapMm = 15.24;
const annotationOffsetMm = 7.62;
/**
 * The renderer draws the reference 5 mm above and the value 5 mm below the symbol origin, so a
 * symbol occupies more sheet height than its pins do. Stacking on pin extents alone lets the
 * value of one symbol land on the reference of the next.
 */
const propertyTextBandMm = 6.35;
/** A4 landscape, leaving room for the frame and the title block. */
const sheetBottomMm = 190.5;
const sheetRightMm = 279.4;
const unassignedBlock = "unassigned";

const snap = (value: number): number => Math.round(value / gridMm) * gridMm;

const blockTitle = (block: string): string =>
  block
    .split("-")
    .map((word) =>
      /^[0-9]/.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");

/**
 * Groups parts by functional block using the rationale records. A part named by several
 * rationales belongs to the first block in the requirement's declared order, so the grouping
 * stays deterministic without asking the rationale author to keep the sets disjoint.
 */
export const schematicBlocks = (fixture: Phase1Fixture): SchematicBlock[] => {
  const declared = fixture.requirement.functionalBlocks;
  const assigned = new Map<string, string>();
  for (const block of declared) {
    for (const rationale of fixture.rationales ?? []) {
      if (!rationale.appliesTo.includes(`block:${block}`)) continue;
      for (const subject of rationale.appliesTo) {
        if (!subject.startsWith("part:")) continue;
        if (!assigned.has(subject)) assigned.set(subject, block);
      }
    }
  }
  const byReference = (left: string, right: string): number => {
    const reference = (partId: string): string =>
      fixture.parts.find((part) => part.id === partId)?.reference ?? partId;
    return reference(left).localeCompare(reference(right));
  };
  const blocks = declared
    .map((block) => ({
      block,
      title: blockTitle(block),
      partIds: fixture.parts
        .map((part) => part.id)
        .filter((partId) => assigned.get(partId) === block)
        .sort(byReference),
    }))
    .filter((entry) => entry.partIds.length > 0);
  const rest = fixture.parts
    .map((part) => part.id)
    .filter((partId) => !assigned.has(partId))
    .sort(byReference);
  return rest.length > 0
    ? [...blocks, { block: unassignedBlock, title: "Unassigned", partIds: rest }]
    : blocks;
};

/** Bounding box of a symbol's pins around its origin, in millimetres. */
export type SymbolExtent = {
  minXMm: number;
  maxXMm: number;
  minYMm: number;
  maxYMm: number;
};

/** Widens a pin extent to the sheet space the symbol really occupies, property text included. */
export const drawnExtent = (extent: SymbolExtent): SymbolExtent => ({
  minXMm: extent.minXMm,
  maxXMm: extent.maxXMm,
  minYMm: Math.min(extent.minYMm, -propertyTextBandMm),
  maxYMm: Math.max(extent.maxYMm, propertyTextBandMm),
});

/**
 * Flows the blocks into columns and stacks each block's symbols vertically, using the drawn
 * extents so two symbols never share sheet space. A block occupies one column whenever it fits;
 * a block too tall for a column continues in the next one instead of running off the page.
 */
export const schematicLayout = (
  fixture: Phase1Fixture,
  extentOf: (partId: string) => SymbolExtent,
): SchematicLayout => {
  const blocks = schematicBlocks(fixture);
  const origins = new Map<string, [number, number]>();
  const annotations: BlockAnnotation[] = [];
  const placed = new Set<string>();
  const blockHeight = (block: SchematicBlock): number =>
    block.partIds.reduce((total, partId) => {
      const extent = drawnExtent(extentOf(partId));
      return total + (extent.maxYMm - extent.minYMm) + symbolGapMm;
    }, annotationOffsetMm);

  let columnLeft = originXMm;
  let columnWidth = 0;
  let cursorY = originYMm;
  for (const block of blocks) {
    if (cursorY > originYMm && cursorY + blockHeight(block) > sheetBottomMm) {
      columnLeft = columnLeft + columnWidth + columnGapMm;
      columnWidth = 0;
      cursorY = originYMm;
    }
    annotations.push({ text: block.title, xMm: snap(columnLeft), yMm: snap(cursorY) });
    cursorY += annotationOffsetMm;
    for (const partId of block.partIds) {
      const extent = drawnExtent(extentOf(partId));
      const height = extent.maxYMm - extent.minYMm;
      if (cursorY > originYMm && cursorY + height > sheetBottomMm) {
        // A block that cannot fit one column is continued in the next one rather than
        // running off the page.
        columnLeft = columnLeft + columnWidth + columnGapMm;
        columnWidth = 0;
        cursorY = originYMm;
      }
      const originX = snap(columnLeft - extent.minXMm);
      const originY = snap(cursorY - extent.minYMm);
      origins.set(partId, [originX, originY]);
      placed.add(partId);
      columnWidth = Math.max(columnWidth, extent.maxXMm - extent.minXMm);
      cursorY = originY + extent.maxYMm + symbolGapMm;
    }
    cursorY += blockGapMm;
  }
  for (const part of fixture.parts) {
    const origin = origins.get(part.id);
    if (!origin) {
      throw new KicadProjectionError(`schematic layout has no cell for ${part.id}`);
    }
    // Export clips whatever falls outside the page, so an oversized layout stops the run
    // instead of silently losing part of the sheet.
    const extent = drawnExtent(extentOf(part.id));
    if (
      origin[0] + extent.minXMm < 0 ||
      origin[0] + extent.maxXMm > sheetRightMm ||
      origin[1] + extent.minYMm < 0 ||
      origin[1] + extent.maxYMm > sheetBottomMm
    ) {
      throw new KicadProjectionError(
        `schematic layout places ${part.id} outside the sheet at ${origin[0]},${origin[1]}`,
      );
    }
  }
  return { origins, annotations, blocks };
};

/**
 * Refuses a layout that would place pins of two different symbols on the same coordinate.
 * Eeschema connects coinciding pins, so such an overlap would silently change the netlist this
 * layout must not touch. Pins that coincide inside one symbol come from the library, not from
 * the layout, and are left to the symbol author.
 */
export const assertNoPinOverlap = (
  pins: readonly { partId: string; entity: string; xMm: number; yMm: number }[],
): void => {
  const seen = new Map<string, { partId: string; entity: string }>();
  for (const pin of pins) {
    const key = `${pin.xMm.toFixed(3)}:${pin.yMm.toFixed(3)}`;
    const previous = seen.get(key);
    if (previous !== undefined && previous.partId !== pin.partId) {
      throw new KicadProjectionError(
        `schematic layout overlaps pins ${previous.entity} and ${pin.entity} at ${key}`,
      );
    }
    seen.set(key, { partId: pin.partId, entity: pin.entity });
  }
};

/** Places a net label outside the symbol body so the label does not sit on top of the pin. */
export const labelJustification = (pinOffsetXMm: number): "left" | "right" =>
  pinOffsetXMm < 0 ? "right" : "left";

export const renderSheetText = (text: string, xMm: number, yMm: number, id: string): string =>
  `	(text "${text}"
		(exclude_from_sim yes)
		(at ${xMm} ${yMm} 0)
		(effects
			(font (size 2.54 2.54) (bold yes))
			(justify left bottom)
		)
		(uuid "${id}")
	)`;

export const renderTitleBlock = (fixture: Phase1Fixture): string =>
  `	(title_block
		(title "${fixture.requirement.name}")
		(rev "${fixture.schemaVersion}")
		(comment 1 "${fixture.fixtureId}")
		(comment 2 "Projected from the ACD design graph; the graph is canonical")
	)`;
