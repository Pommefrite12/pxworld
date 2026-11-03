import { describe, expect, it } from "vitest";
import { previewStorage, resolvePreview } from "@/lib/doom/preview";

describe("which moment of the story a page shows", () => {
  it("shows nothing when nothing is asked and nothing is configured", () => {
    expect(resolvePreview(null, null, "")).toBe("");
  });
  it("follows the address, then the tab's memory, then the deployment's default", () => {
    expect(resolvePreview("J-9", "0", "J-40")).toBe("J-9");
    expect(resolvePreview(null, "0", "J-40")).toBe("0");
    expect(resolvePreview(null, null, "J-40")).toBe("J-40");
  });
  it("lets a visitor switch the default off for their tab, and bring it back", () => {
    expect(resolvePreview("off", null, "J-40")).toBe("off");
    expect(resolvePreview("OFF", "J-9", "J-40")).toBe("off");
    expect(resolvePreview("", null, "J-40")).toBe("off");
    expect(resolvePreview(null, "off", "J-40")).toBe("off"); // remembered
    expect(resolvePreview("default", "off", "J-40")).toBe("J-40");
  });
  it("remembers a chosen moment for the tab, and forgets it on request", () => {
    expect(previewStorage(null, "J-40")).toEqual({ action: "keep" });
    expect(previewStorage("J-3", "J-40")).toEqual({ action: "set", value: "J-3" });
    expect(previewStorage("default", "J-40")).toEqual({ action: "forget" });
  });
  it("remembers 'off' only when there is a default to switch off (else the plain site is already what it shows)", () => {
    expect(previewStorage("off", "J-40")).toEqual({ action: "set", value: "off" });
    expect(previewStorage("off", "")).toEqual({ action: "forget" });
    expect(previewStorage("", "")).toEqual({ action: "forget" });
  });
});
