import { describe, expect, it } from "vitest";
import { FINALE_SECONDS, SWEEP_END, SWEEP_START, finaleAt, frontX, labelPlan, shakeOffset, shakeZoom } from "@/lib/doom/finale";

describe("the final sequence timeline", () => {
  it("does nothing before it starts and ends with the sweep complete", () => {
    expect(finaleAt(-1)).toEqual({ sweep: 0, flash: 0, shake: 0, done: false });
    expect(finaleAt(0).sweep).toBe(0);
    expect(finaleAt(SWEEP_START).sweep).toBe(0);
    expect(finaleAt(SWEEP_END)).toMatchObject({ sweep: 1, done: true });
    expect(finaleAt(60)).toMatchObject({ sweep: 1, done: true });
    expect(FINALE_SECONDS).toBeGreaterThan(SWEEP_END);
  });
  it("is slow and imposing: more than ten seconds of sweep", () => {
    expect(SWEEP_END - SWEEP_START).toBeGreaterThan(10);
  });
  it("sweeps from west to east, only ever forward, slowly at the start and at the end, fastest in the middle", () => {
    let last = -1;
    for (let t = 0; t <= 15; t += 0.05) { const s = finaleAt(t).sweep; expect(s).toBeGreaterThanOrEqual(last); last = s; }
    expect(finaleAt(SWEEP_START + 0.5).sweep).toBeLessThan(0.01);
    expect(finaleAt((SWEEP_START + SWEEP_END) / 2).sweep).toBeCloseTo(0.5, 6);
    expect(finaleAt(SWEEP_END - 0.5).sweep).toBeGreaterThan(0.99);
    const speed = (t: number) => finaleAt(t + 0.1).sweep - finaleAt(t).sweep;
    expect(speed((SWEEP_START + SWEEP_END) / 2)).toBeGreaterThan(speed(SWEEP_START + 1) * 3);
  });
  it("flashes once, a little longer than a blink, at the very start — never a strobe", () => {
    let flashing = 0, last = 1;
    for (let t = 0; t <= 15; t += 0.01) {
      const f = finaleAt(t).flash;
      if (f > 0) flashing++;
      expect(f).toBeLessThanOrEqual(last + 1e-9); // it only ever fades: no second flash
      last = f;
    }
    expect(flashing * 0.01).toBeGreaterThan(0.3);
    expect(flashing * 0.01).toBeLessThan(0.6);
    expect(finaleAt(0).flash).toBe(1);
    expect(finaleAt(0.05).flash).toBe(1); // held white for an instant
    expect(finaleAt(0.2).flash).toBeGreaterThan(0.2);
    expect(finaleAt(0.45).flash).toBe(0);
    for (let t = 0.45; t <= 15; t += 0.05) expect(finaleAt(t).flash).toBe(0); // it never comes back
  });
  it("shakes hard for two seconds at the start, then a low rumble under the sweep and three heavy impacts, well apart", () => {
    expect(finaleAt(0).shake).toBe(1);
    expect(finaleAt(1).shake).toBeGreaterThan(0.3);
    expect(finaleAt(2.2 + 0.01).shake).toBeLessThanOrEqual(0.11); // after the first shake, only the rumble is left
    const span = SWEEP_END - SWEEP_START;
    expect(finaleAt(SWEEP_START + span / 2 + 1.2).shake).toBeGreaterThan(0); // the rumble
    expect(finaleAt(SWEEP_START + span / 2 + 1.2).shake).toBeLessThanOrEqual(0.11);
    expect(finaleAt(SWEEP_END).shake).toBeLessThan(0.01); // …and it dies away with the sweep
    const impacts: number[] = [];
    let was = 0;
    for (let t = 2.3; t <= 15; t += 0.01) { const s = finaleAt(t).shake; if (s > 0.3 && was <= 0.3) impacts.push(t); was = s; expect(s).toBeLessThanOrEqual(0.55 + 1e-9); }
    expect(impacts).toHaveLength(3);
    expect(impacts[1]! - impacts[0]!).toBeGreaterThan(span / 5); // never more than one impact every few seconds
  });
  it("throws the picture smoothly and boundedly, and not at all without a shake", () => {
    expect(shakeOffset(0.3, 0)).toEqual({ x: 0, y: 0, rot: 0 });
    let jump = 0, last = shakeOffset(0, 1);
    for (let t = 0; t <= 3; t += 1 / 60) {
      const o = shakeOffset(t, 1);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(18 + 1e-9);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(13 + 1e-9);
      expect(Math.abs(o.rot)).toBeLessThanOrEqual(0.45 + 1e-9);
      jump = Math.max(jump, Math.abs(o.x - last.x));
      last = o;
    }
    expect(jump).toBeLessThan(12); // from one frame to the next it moves a few pixels, it does not teleport
    expect(Math.abs(shakeOffset(0.37, 0.5).x)).toBeCloseTo(Math.abs(shakeOffset(0.37, 1).x) / 2, 9);
  });
  it("scales the picture up just enough that the shake never shows its edges, on a desktop or on a phone", () => {
    for (const [w, h] of [[1360, 800], [390, 800], [800, 390]] as const) {
      let most = 1;
      for (let t = 0; t <= 4; t += 0.013) {
        const shake = Math.max(0, 1 - t / 3), o = shakeOffset(t, shake, Math.min(w, h)), s = shakeZoom(o, w, h), rad = (o.rot * Math.PI) / 180;
        most = Math.max(most, s);
        // every corner of the screen must still fall inside the picture once it is scaled, rotated and moved
        for (const [cx, cy] of [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]] as const) {
          const dx = (cx - o.x) / s, dy = (cy - o.y) / s;
          const px = dx * Math.cos(-rad) - dy * Math.sin(-rad), py = dx * Math.sin(-rad) + dy * Math.cos(-rad);
          expect(Math.abs(px)).toBeLessThanOrEqual(w / 2 + 1e-6);
          expect(Math.abs(py)).toBeLessThanOrEqual(h / 2 + 1e-6);
        }
      }
      expect(most).toBeLessThan(1.14); // a punch of the camera, not a different map
    }
    expect(shakeZoom({ x: 0, y: 0, rot: 0 }, 1360, 800)).toBe(1);
  });
  it("puts the front of the sweep just off the left edge at the start and just off the right edge at the end", () => {
    expect(frontX(0, 1360)).toBeLessThan(0);
    expect(frontX(1, 1360)).toBeGreaterThan(1360);
    expect(frontX(0.5, 1360)).toBeCloseTo(680, 6);
    let last = -Infinity;
    for (let s = 0; s <= 1; s += 0.1) { const x = frontX(s, 800); expect(x).toBeGreaterThan(last); last = x; }
  });
  it("for someone who asked for fewer animations: only a fade-in of the end state, in a few seconds", () => {
    for (let t = -1; t <= 5; t += 0.1) { const f = finaleAt(t, true); expect(f.flash).toBe(0); expect(f.shake).toBe(0); }
    expect(finaleAt(0, true).sweep).toBe(0);
    expect(finaleAt(1.8, true).sweep).toBeGreaterThan(0.3);
    expect(finaleAt(1.8, true).sweep).toBeLessThan(0.7);
    expect(finaleAt(3.5, true)).toMatchObject({ sweep: 1, done: true });
    let last = -1;
    for (let t = 0; t <= 4; t += 0.05) { const s = finaleAt(t, true).sweep; expect(s).toBeGreaterThanOrEqual(last); last = s; }
  });
});

describe("the names on the map during the sequence", () => {
  const W = 1360;
  it("keeps them whole ahead of the front and erases the ones behind it, a few tearing away right behind it", () => {
    const front = 680, plan = labelPlan(0.5, front, W, false);
    expect(plan.whole).toEqual([680, W]);
    expect(plan.tearing).toEqual([570, 680]);
    expect(plan.alpha).toBe(1);
  });
  it("shows them all before the front comes in, and none when it has gone past", () => {
    expect(labelPlan(0, frontX(0, W), W, false)).toEqual({ whole: [0, W], tearing: null, alpha: 1 });
    const end = labelPlan(1, frontX(1, W), W, false);
    expect(end.whole![0]).toBe(W); // an empty band at the right edge: nothing is left
    expect(end.whole![1]).toBe(W);
  });
  it("only ever loses names: the part of the screen where they stay shrinks as the sweep goes", () => {
    let last = Infinity;
    for (let s = 0; s <= 1; s += 0.05) { const [a, b] = labelPlan(s, frontX(s, W), W, false).whole!; expect(b - a).toBeLessThanOrEqual(last); last = b - a; }
  });
  it("fades them out for someone who asked for fewer animations, instead of tearing them away", () => {
    expect(labelPlan(0, 0, W, true)).toEqual({ whole: [0, W], tearing: null, alpha: 1 });
    expect(labelPlan(0.4, 0, W, true).alpha).toBeCloseTo(0.6, 9);
    expect(labelPlan(1, 0, W, true).alpha).toBe(0);
  });
});
