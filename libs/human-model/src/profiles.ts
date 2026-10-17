/** Lightweight profile metadata; safe to import without loading Three.js. */
export const MODEL_PROFILES = {
  female: {
    ariaLabel: "Interactive realistic female human model",
    index: "02",
    label: "Female",
    name: "Realistic female",
    url: "/models/segmented/realistic-female-segmented.glb",
  },
  male: {
    ariaLabel: "Interactive realistic male human model",
    index: "01",
    label: "Male",
    name: "Realistic male",
    url: "/models/segmented/realistic-male-segmented.glb",
  },
} as const;

export type ModelProfile = keyof typeof MODEL_PROFILES;
