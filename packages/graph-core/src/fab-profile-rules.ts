export type FabProfileRule = {
  ruleId: string;
  textPatterns: string[];
  classification:
    | "mask-clearance"
    | "pad-geometry"
    | "courtyard-clearance"
    | "drill"
    | "silkscreen"
    | "spacing"
    | "solderability";
  confidence: number;
  reproductionConditions: string[];
};

export type FabProfileRules = {
  profileId: string;
  version: string;
  confidenceFloor: number;
  rules: FabProfileRule[];
};

export const fabProfileRules: FabProfileRules[] = [
  {
    profileId: "fab:jlcpcb-class-2layer",
    version: "0.1.0",
    confidenceFloor: 0.8,
    rules: [
      {
        ruleId: "mask-sliver-min",
        textPatterns: ["solder mask sliver", "mask sliver"],
        classification: "mask-clearance",
        confidence: 0.98,
        reproductionConditions: ["2-layer", "HASL", "0.1mm minimum mask sliver"],
      },
      {
        ruleId: "copper-clearance-min",
        textPatterns: ["copper clearance", "clearance below profile minimum"],
        classification: "spacing",
        confidence: 0.91,
        reproductionConditions: ["2-layer", "0.127mm copper clearance profile"],
      },
      {
        ruleId: "silkscreen-edge",
        textPatterns: ["silkscreen", "board edge"],
        classification: "silkscreen",
        confidence: 0.88,
        reproductionConditions: ["2-layer", "board-edge silkscreen exclusion"],
      },
      {
        ruleId: "pad-geometry",
        textPatterns: ["pad geometry", "pad shape"],
        classification: "pad-geometry",
        confidence: 0.9,
        reproductionConditions: ["2-layer", "fab pad geometry profile"],
      },
    ],
  },
];

export const rulesForFabProfile = (profileId: string): FabProfileRules | undefined =>
  fabProfileRules.find((profile) => profile.profileId === profileId);
