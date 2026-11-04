/** The pictures of the story (the owner's, in `assets/story-source`, prepared by `scripts/build-story.mts` into `public/story`). */
export const PANELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const PANEL_COUNT = PANELS.length;
/** Picture size, in pixels (16:9). */
export const PANEL_WIDTH = 1280;
export const PANEL_HEIGHT = 720;
/** Automatic reading: how long each picture stays (the captions are long enough to need a moment). */
export const AUTO_MS = 9000;
export const panelSrc = (n: number) => `/story/panel-${n}.webp`;
