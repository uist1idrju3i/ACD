# ADR-0007: KiCad minimum supported version

**Status: Proposed / 未決定**

## Context

KiCad 10.0 was released in March 2026, and KiCad 9.x is no longer actively
maintained. The KiCad source tree removed SWIG, wxPython, and the legacy Python
integration in March 2026, making the IPC API the forward-looking automation
boundary. Official `kicad-python` documentation lists `get_schematic()` as
added in KiCad 11.

ACD needs a stable baseline for batch verification, generated projections,
guarded live edits, and schematic import/export. Selecting a baseline affects
the IPC capability matrix, installation requirements, fallback file-generation
path, and the reproducibility of golden tasks.

## Options

1. **KiCad 10 baseline:** use `kicad-cli` and PCB IPC capabilities, with
   capability detection and generated S-expression fallback for schematic
   projections.
2. **KiCad 11 baseline:** require the newer schematic IPC surface where
   available, reducing reliance on direct schematic file generation.
3. **Version-matrix support:** support KiCad 10 and 11 with explicit capability
   profiles and refuse unsupported operations rather than silently degrading.

## Decision criteria

- Availability and stability of the required PCB and schematic IPC operations.
- `kicad-cli` ERC/DRC/export parity across supported versions.
- Re-open validation and deterministic golden-task reproducibility.
- Installation and upgrade burden for browser, local-worker, and CI modes.
- Library/file-format compatibility and migration behavior.
- Security and auditability of guarded edits.

## Decision

未決定。The minimum supported version and fallback policy will be selected
after the required ACD interoperability fixtures and KiCad capability tests
exist. Until then, [`kicad-interop.md`](../kicad-interop.md) must retain
version-aware capability detection and must not assume schematic IPC is
available on every supported installation.

## Consequences

- ACD must keep the design graph canonical and treat KiCad artifacts as
  projections regardless of the selected baseline.
- CI should exercise the selected baseline and any explicitly supported
  compatibility profile.
- Changing the baseline requires updating this ADR, the capability matrix, and
  golden-task fixtures.
