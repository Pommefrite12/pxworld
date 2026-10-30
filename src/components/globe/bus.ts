/**
 * The home page's header (search box, "Find your spot") and the globe are separate components that cannot call each
 * other: they talk through two window events.
 */
export const GLOBE_GOTO = "px-globe-goto";
export const GLOBE_BUY = "px-globe-buy";

export interface GlobeGoto { lon: number; lat: number; zoom: number }

export const flyGlobeTo = (d: GlobeGoto) => window.dispatchEvent(new CustomEvent<GlobeGoto>(GLOBE_GOTO, { detail: d }));
export const startBuyFromGlobe = () => window.dispatchEvent(new Event(GLOBE_BUY));
