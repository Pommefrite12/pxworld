/**
 * The colours of the map, shared by the map engine and by the planisphere of the home page. NIGHT is the archive's own (the ocean stays BLUE, a deep
 * night blue; the land is violet; the coasts and the borders are drawn in soft gold; what is active, selected or free is cyan; what is collecting is
 * gold). LIGHT is the previous look: it is only used while the old countdown story is on (its corrupted land was drawn for it) and goes away with it.
 * Strings of "r,g,b" are for `rgba(${…}, alpha)`.
 */
export const NIGHT_PALETTE = {
  paper: "#190921", ocean: "#0d1a3e", land: "#382050",
  ink: "214,171,114",   // coasts, borders, grid: gold, at the strength each line needs
  text: "241,232,223", halo: "25,9,33", // the names of the places: ivory with a night halo
  hover: "241,232,223", bar: "25,9,33", markerEdge: "#190921",
  free: "85,199,209", accent: "214,171,114", danger: "255,122,112",
  hatchA: "#2e1a45", hatchB: "#4a3069", hatchFallback: "#3a2358",
};
export type MapPalette = typeof NIGHT_PALETTE;
export const LIGHT_PALETTE: MapPalette = {
  paper: "#fcf9f2", ocean: "#c9dfe8", land: "#fbf5e6",
  ink: "31,37,64",
  text: "31,37,64", halo: "251,245,230",
  hover: "31,37,64", bar: "31,37,64", markerEdge: "#fff",
  free: "18,184,134", accent: "240,67,22", danger: "217,45,32",
  hatchA: "#e3ddcf", hatchB: "#c9c1ae", hatchFallback: "#ddd",
};
