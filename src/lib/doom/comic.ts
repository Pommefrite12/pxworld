/** The pictures of the story (the owner's, in `assets/story-source`, prepared by `scripts/build-story.mts` into `public/story`). */
export const PANELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const PANEL_COUNT = PANELS.length;
/** Picture size, in pixels (16:9). */
export const PANEL_WIDTH = 1280;
export const PANEL_HEIGHT = 720;
/** How long a picture takes to come in (a wipe, from the right when going on, from the left when going back), in ms: the same in the CSS. */
export const WIPE_MS = 450;
export const panelSrc = (n: number) => `/story/panel-${n}.webp`;
