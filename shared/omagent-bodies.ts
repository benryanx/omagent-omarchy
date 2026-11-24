import type { MascotBody } from "./mascot-bodies.ts";
type CursorSilhouette = Omit<MascotBody, "id">;

export const OMAGENT_SHAPE_OUTLINES = {
  step: {
    name: "Step",
    points: [[80, 0], [200, 0], [200, 120], [160, 120], [160, 160], [120, 160], [120, 200], [0, 200], [0, 80], [40, 80], [40, 40], [80, 40]],
  },
  notch: {
    name: "Notch",
    points: [[0, 0], [80, 0], [80, 32], [160, 32], [160, 0], [200, 0], [200, 200], [120, 200], [120, 168], [40, 168], [40, 200], [0, 200]],
  },
} as const;

function silhouette(shape: (typeof OMAGENT_SHAPE_OUTLINES)[keyof typeof OMAGENT_SHAPE_OUTLINES]): CursorSilhouette {
  const path = shape.points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join("") + "Z";
  return {
    name: shape.name,
    fit: "scale(1.142705)",
    body: `<path d="${path}" fill="{{GRADIENT}}"/>`,
    clip: `<path d="${path}"/>`,
    anchor: { x: 114.27, y: 114.27, scale: 0.791 },
  };
}

export const OMAGENT_SHAPES = {
  step: silhouette(OMAGENT_SHAPE_OUTLINES.step),
  notch: silhouette(OMAGENT_SHAPE_OUTLINES.notch),
};

/** Exact path supplied in omarchy-logo-matte-black.svg; theme fills replace the source gradient. */
const OMARCHY_LOGO_PATH = "m1200 1200h-480v-80h400v-1040h-479.996v160h-400v720h720v-720h-80v-80h159.996v880h-400v160h-640v-1200h1200zm-1120-80h480v-80h-400l.004-400h-80.004zm0-560h80.004v-400h400v-80h-480.004z";

export const OMARCHY_SILHOUETTE: CursorSilhouette = {
  name: "Omagent",
  fit: "scale(0.19045083333333333)",
  body: `<path d="${OMARCHY_LOGO_PATH}" fill="{{GRADIENT}}" fill-rule="evenodd" clip-rule="evenodd"/>`,
  clip: '<path d="M240 240H960V960H240Z"/>',
  anchor: { x: 114, y: 112, scale: 0.66 },
};

export const OMAGENT_BODY_IDS = ["omarchy", "circle", "squircle", "star", "step", "notch"] as const;
export const OMAGENT_BODY_NAMES = { omarchy: "Omarchy", circle: "Circle", squircle: "Square", star: "Star", step: "Step", notch: "Notch" } as const;
export const OMAGENT_CUSTOM_BODIES = { omarchy: OMARCHY_SILHOUETTE, ...OMAGENT_SHAPES };
export type OmagentCustomBodyId = keyof typeof OMAGENT_CUSTOM_BODIES;
export function isOmagentCustomBody(value: unknown): value is OmagentCustomBodyId {
  return typeof value === "string" && Object.hasOwn(OMAGENT_CUSTOM_BODIES, value);
}
