export const sessionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "QuizSessionInput",
  type: "object",
  required: ["technologies"],
  properties: {
    technologies: { type: "array", items: { type: "string" }, minItems: 1 },
    difficulty: {
      type: "string",
      enum: ["Easy", "Medium", "Hard", "Mixed"],
      default: "Medium",
    },
    jobTitle: {
      type: "string",
      enum: [
        "Junior Developer",
        "Mid-level Developer",
        "Senior Developer",
        "Lead",
        "Architect",
      ],
      default: "Senior Developer",
    },
    questionsPerTech: {
      type: "integer",
      minimum: 1,
      maximum: 20,
      default: 4,
    },
    timingMode: {
      type: "string",
      enum: ["none", "per-tech", "global"],
      default: "none",
    },
    timeoutMinutes: {
      type: "integer",
      minimum: 1,
      maximum: 180,
      default: 4,
    },
    revealMode: {
      type: "string",
      enum: ["immediate", "end"],
      default: "immediate",
    },
    extraSpecifications: { type: "string" },
  },
  additionalProperties: false,
} as const;
