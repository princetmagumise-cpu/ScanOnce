import { describe, it, expect } from "vitest";
import { AutoCapture, frameDiff } from "../src/lib/autocapture";

describe("auto capture", () => {
  it("captures after holding still for 3 seconds, once per scene", () => {
    const a = new AutoCapture();
    expect(a.step(0, 20, 20).phase).toBe("waiting"); // moving
    const s = a.step(100, 1, 0);
    expect(s).toMatchObject({ phase: "counting", remaining: 3, anchor: true });
    expect(a.step(1200, 1, 2).remaining).toBe(2);
    expect(a.step(2500, 2, 3).remaining).toBe(1);
    const shot = a.step(3150, 1, 3);
    expect(shot).toMatchObject({ capture: true, phase: "rearm", anchor: true });
    // Same page still in view: no second capture, however long it stays.
    expect(a.step(9000, 1, 2)).toMatchObject({ capture: false, phase: "rearm" });
    // Page turned: the view changes, then settles, and the countdown restarts.
    expect(a.step(9500, 30, 40).phase).toBe("waiting");
    expect(a.step(9600, 1, 0).phase).toBe("counting");
  });

  it("cancels the countdown on movement or slow drift", () => {
    const a = new AutoCapture();
    a.step(0, 1, 0);
    expect(a.step(1000, 9, 9).phase).toBe("waiting"); // shake
    a.step(1100, 1, 0);
    expect(a.step(2000, 2, 14).phase).toBe("waiting"); // drifted away slowly
  });

  it("waits for a new scene after a manual shot", () => {
    const a = new AutoCapture();
    a.captured();
    expect(a.step(0, 1, 1).phase).toBe("rearm");
  });

  it("measures frame differences", () => {
    expect(frameDiff(new Uint8Array([0, 10, 20]), new Uint8Array([0, 10, 20]))).toBe(0);
    expect(frameDiff(new Uint8Array([0, 0]), new Uint8Array([10, 30]))).toBe(20);
  });
});
