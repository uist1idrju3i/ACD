# KiCad official library pinning spike

This spike pins the KiCad official symbol and footprint library boundary to the
same `kicad/kicad:10.0` container used by the Phase 0/1 CI profile.

- Image: `kicad/kicad:10.0`
- KiCad: `10.0.5`
- Digest: `sha256:182c8005cb775a2c448a4c18681d489f1ff472a761885eba3e08b07e3c0564de`
- Library license note: KiCad official libraries are documented as
  `CC-BY-SA-4.0-with-exception`; retain upstream notices and verify the exact
  notice before redistribution.

`manifest.json` is a machine-readable draft. `contentHash` remains `null` until
an explicit library snapshot export is chosen; the container digest is the
current reproducibility anchor. The smoke projection writes local library tables
pointing at the pinned container paths. Board reopen and DRC capability were
verified in that container; schematic symbol projection remains a spike gap.
