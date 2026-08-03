import type { ACDPhase1Fixture as Phase1Fixture } from "./generated/phase1-fixture.js";

export const validatePhase1FixtureReferences = (fixture: Phase1Fixture): string[] => {
  const errors: string[] = [];
  const parts = new Map(fixture.parts.map((part) => [part.id, part]));
  const mappings = new Map(fixture.mappings.map((mapping) => [mapping.partId, mapping]));
  const placements = new Map(
    fixture.placementConstraints.components.map((placement) => [placement.partId, placement]),
  );
  const bom = new Map(fixture.bom.map((line) => [line.partId, line]));
  const pinsByNet = new Map<string, string>();

  for (const part of fixture.parts) {
    if (!mappings.has(part.id)) {
      errors.push(`reference-integrity: part ${part.id} has no symbol-footprint mapping`);
    }
    if (!placements.has(part.id)) {
      errors.push(`reference-integrity: part ${part.id} has no placement constraint`);
    }
    if (!bom.has(part.id)) {
      errors.push(`reference-integrity: part ${part.id} has no BOM line`);
    }
  }

  for (const mapping of fixture.mappings) {
    if (!parts.has(mapping.partId)) {
      errors.push(`reference-integrity: mapping references unknown part ${mapping.partId}`);
    }
  }

  for (const placement of fixture.placementConstraints.components) {
    if (!parts.has(placement.partId)) {
      errors.push(`reference-integrity: placement references unknown part ${placement.partId}`);
    }
  }

  for (const line of fixture.bom) {
    if (!parts.has(line.partId)) {
      errors.push(`reference-integrity: BOM references unknown part ${line.partId}`);
    }
  }

  for (const net of fixture.nets) {
    for (const pin of net.pins) {
      const pinKey = `${pin.partId}:${pin.pin}`;
      const previousNet = pinsByNet.get(pinKey);
      if (previousNet) {
        errors.push(
          `reference-integrity: pin ${pinKey} appears on multiple nets ${previousNet}, ${net.id}`,
        );
      } else {
        pinsByNet.set(pinKey, net.id ?? net.name);
      }
      const part = parts.get(pin.partId);
      if (!part) {
        errors.push(`reference-integrity: net ${net.id} references unknown part ${pin.partId}`);
        continue;
      }
      const mapping = mappings.get(pin.partId);
      if (!mapping?.pinPads.some((pinPad) => pinPad.pin === pin.pin)) {
        errors.push(
          `reference-integrity: net ${net.id} references unknown pin ${pin.partId}:${pin.pin}`,
        );
      }
    }
  }

  const validTargets = new Set([
    ...(fixture.requirement?.id ? [fixture.requirement.id] : []),
    ...(fixture.requirement?.functionalBlocks ?? []).map((block) => `block:${block}`),
    ...fixture.parts.map((part) => part.id),
  ]);
  for (const rationale of fixture.rationales ?? []) {
    for (const target of rationale.appliesTo) {
      if (!validTargets.has(target)) {
        errors.push(
          `reference-integrity: rationale ${rationale.id} references unknown target ${target}`,
        );
      }
    }
  }

  return errors;
};
