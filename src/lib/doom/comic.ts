/** The comic strip of the story: six pictures drawn by `scripts/build-comic.mts`, served from `public/story`. */
export const PANELS = [1, 2, 3, 4, 5, 6] as const;
export const PANEL_COUNT = PANELS.length;
/** Picture sizes (the generator draws 240×135 and scales it ×4, so that the pixels stay square and sharp). */
export const PANEL_WIDTH = 960;
export const PANEL_HEIGHT = 540;
/** Automatic reading: how long each picture stays. */
export const AUTO_MS = 7000;
export const panelSrc = (n: number) => `/story/panel-${n}.png`;
