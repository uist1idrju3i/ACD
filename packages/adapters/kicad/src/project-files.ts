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

export const renderFootprintLibraryTable = (): string => `(fp_lib_table
  (version 7)
  (lib (name "Connector_JST") (type "KiCad") (uri "/usr/share/kicad/footprints/Connector_JST.pretty") (options "") (descr "KiCad official footprint library"))
  (lib (name "Resistor_SMD") (type "KiCad") (uri "/usr/share/kicad/footprints/Resistor_SMD.pretty") (options "") (descr "KiCad official footprint library"))
  (lib (name "LED_SMD") (type "KiCad") (uri "/usr/share/kicad/footprints/LED_SMD.pretty") (options "") (descr "KiCad official footprint library"))
  (lib (name "Capacitor_SMD") (type "KiCad") (uri "/usr/share/kicad/footprints/Capacitor_SMD.pretty") (options "") (descr "KiCad official footprint library"))
)`;

export const renderSymbolLibraryTable = (): string => `(sym_lib_table
  (version 7)
  (lib (name "Connector_Generic") (type "KiCad") (uri "/usr/share/kicad/symbols/Connector_Generic.kicad_sym") (options "") (descr "KiCad official symbol library"))
  (lib (name "Device") (type "KiCad") (uri "/usr/share/kicad/symbols/Device.kicad_sym") (options "") (descr "KiCad official symbol library"))
  (lib (name "power") (type "KiCad") (uri "/usr/share/kicad/symbols/power.kicad_sym") (options "") (descr "KiCad official symbol library"))
)`;
