// Hands-free capture: when the camera holds still for a few seconds, take
// the picture. Pure logic, fed with motion measurements, so it's testable.

/** Mean absolute difference (0–255) between two equally sized grayscale frames. */
export function frameDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return a.length ? sum / a.length : 0;
}

export type Phase = "waiting" | "counting" | "rearm";

export interface Step {
  phase: Phase;
  /** Whole seconds left in the countdown (only while counting). */
  remaining: number;
  /** True once: take the picture now. */
  capture: boolean;
  /** True when the caller should remember the current frame as the new reference. */
  anchor: boolean;
}

export class AutoCapture {
  phase: Phase = "waiting";
  private start = 0;

  constructor(
    /** How long the view must stay still before capturing. */
    readonly holdMs = 3000,
    /** Frame-to-frame change below this counts as "still" (hand tremor, sensor noise). */
    readonly still = 5,
    /** Change from the frame where the countdown began that cancels it (slow drift). */
    readonly drift = 12,
    /** After a capture, how different the view must become before the next one (a new page). */
    readonly change = 18
  ) {}

  /**
   * @param motion difference from the previous sample
   * @param fromAnchor difference from the reference frame (countdown start, or last capture)
   */
  step(now: number, motion: number, fromAnchor: number): Step {
    const out = (phase: Phase, extra: Partial<Step> = {}): Step => {
      this.phase = phase;
      return { phase, remaining: 0, capture: false, anchor: false, ...extra };
    };
    switch (this.phase) {
      case "waiting":
        if (motion < this.still) {
          this.start = now;
          return out("counting", { remaining: Math.ceil(this.holdMs / 1000), anchor: true });
        }
        return out("waiting");
      case "counting": {
        if (motion >= this.still || fromAnchor >= this.drift) return out("waiting");
        const left = this.holdMs - (now - this.start);
        if (left <= 0) return out("rearm", { capture: true, anchor: true });
        return out("counting", { remaining: Math.ceil(left / 1000) });
      }
      case "rearm":
        // Wait for a different scene (turned page, next document) before counting again.
        return fromAnchor >= this.change ? out("waiting") : out("rearm");
    }
  }

  /** A manual shot also needs the scene to change before auto capture resumes. */
  captured() {
    this.phase = "rearm";
  }

  reset() {
    this.phase = "waiting";
  }
}
