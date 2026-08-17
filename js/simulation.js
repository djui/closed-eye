const TWO_PI = Math.PI * 2;

function rand(min = 0, max = 1) {
  return min + Math.random() * (max - min);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

class Point {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = radius;
    this.restX = x;
    this.restY = y;
    this.phase = Math.random() * TWO_PI;
  }
}

class Floater {
  constructor(kind, aspect) {
    this.kind = kind;
    this.closed = kind === "loop" || kind === "cell";
    this.points = [];
    this.rest = [];
    this.density = rand(0.58, 1.0);
    this.morph = rand(0, TWO_PI);
    this.morphSpeed = rand(0.04, 0.11);
    this.build(aspect);
  }

  build(aspect) {
    const cx = rand(-aspect * 0.55, aspect * 0.55);
    const cy = rand(-0.42, 0.5);
    if (this.kind === "thread") this.makeThread(cx, cy);
    else if (this.kind === "loop") this.makeLoop(cx, cy);
    else if (this.kind === "tangle") this.makeTangle(cx, cy);
    else this.makeCell(cx, cy);

    this.rest = this.points.map((p, i) => {
      const q = this.points[(i + 1) % this.points.length];
      return Math.hypot(q.x - p.x, q.y - p.y);
    });
    if (!this.closed) this.rest[this.rest.length - 1] = 0;
  }

  makeThread(cx, cy) {
    const n = 16 + ((Math.random() * 8) | 0);
    let angle = rand(0, TWO_PI);
    let x = cx;
    let y = cy;
    const step = rand(0.028, 0.05);
    const rad = rand(0.01, 0.02);
    for (let i = 0; i < n; i++) {
      angle += rand(-0.72, 0.72);
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step * 0.85;
      const r = rad * (0.75 + 0.55 * Math.sin((i / n) * Math.PI));
      this.points.push(new Point(x, y, r));
    }
  }

  makeLoop(cx, cy) {
    const n = 18 + ((Math.random() * 8) | 0);
    const rx = rand(0.06, 0.14);
    const ry = rand(0.04, 0.11);
    const rot = rand(0, TWO_PI);
    const rad = rand(0.009, 0.017);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TWO_PI;
      const wobble = 1 + 0.18 * Math.sin(t * 3.0 + rot);
      const px = Math.cos(t) * rx * wobble;
      const py = Math.sin(t) * ry * wobble;
      const x = cx + px * Math.cos(rot) - py * Math.sin(rot);
      const y = cy + px * Math.sin(rot) + py * Math.cos(rot);
      this.points.push(new Point(x, y, rad * rand(0.85, 1.2)));
    }
  }

  makeTangle(cx, cy) {
    const n = 22 + ((Math.random() * 6) | 0);
    let angle = rand(0, TWO_PI);
    let x = cx;
    let y = cy;
    const rad = rand(0.008, 0.015);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      angle += rand(-0.42, 0.42) + 0.42 * Math.sin(t * 7.5);
      if (t > 0.38 && t < 0.78) angle += 0.48;
      x += Math.cos(angle) * 0.03;
      y += Math.sin(angle) * 0.026;
      const r = rad * (0.7 + 0.5 * Math.abs(Math.sin(t * Math.PI)));
      this.points.push(new Point(x, y, r));
    }
    this.closed = false;
  }

  makeCell(cx, cy) {
    this.makeLoop(cx, cy);
    let angle = rand(0, TWO_PI);
    const last = this.points[0];
    let x = last.x;
    let y = last.y;
    const n = 7 + ((Math.random() * 5) | 0);
    for (let i = 0; i < n; i++) {
      angle += rand(-0.5, 0.5);
      x += Math.cos(angle) * 0.03;
      y += Math.sin(angle) * 0.026;
      this.points.push(new Point(x, y, last.radius * rand(0.6, 0.95)));
    }
    this.closed = false;
  }
}

export class Simulation {
  constructor() {
    this.aspect = 1;
    this.floaters = [];
    this.fluid = { x: 0, y: 0 };
    this.eye = { x: 0, y: 0 };
    this.eyeTarget = { x: 0, y: 0 };
    this.saccade = 0;
    this.pressure = 0.18;
    this.pressureDisplay = 0.18;
    this.autoPressure = 0.18;
    this.manualUntil = 0;
    this.autoPhase = Math.random() * Math.PI * 2;
    this.gazeMode = "auto";
    this.inputQuietUntil = 0;
    this.reducedMotion =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    this.auto = this.createAutoGaze();
    this.time = 0;
    this.seedFloaters(1);
  }

  createAutoGaze() {
    return {
      mode: "pause",
      until: 1.8,
      drift: { x: 0, y: 0 },
      tremor: { x: 0, y: 0 },
    };
  }

  seedFloaters(aspect) {
    this.aspect = aspect;
    const kinds = ["thread", "loop", "tangle", "thread", "cell", "loop", "thread"];
    const count = 7;
    this.floaters = [];
    for (let i = 0; i < count; i++) {
      this.floaters.push(new Floater(kinds[i % kinds.length], aspect));
    }
  }

  setAspect(aspect) {
    if (Math.abs(aspect - this.aspect) > 0.08) {
      this.seedFloaters(aspect);
    } else {
      this.aspect = aspect;
    }
  }

  impulse(dx, dy) {
    const mag = Math.hypot(dx, dy);
    if (mag < 1e-6) return;
    this.eyeTarget.x += clamp(dx, -1.6, 1.6);
    this.eyeTarget.y += clamp(dy, -1.6, 1.6);
    this.saccade = Math.min(1, this.saccade + mag * 0.65);
    this.inputQuietUntil = this.time + 4.2;
  }

  setPressure(value, manual) {
    this.pressure = clamp(value, 0, 1);
    if (manual) this.manualUntil = this.time + 16;
  }

  stepAutoGaze(dt) {
    const a = this.auto;
    a.until -= dt;
    a.tremor.x = (Math.random() - 0.5) * 0.018;
    a.tremor.y = (Math.random() - 0.5) * 0.018;

    if (a.until <= 0) {
      const roll = Math.random();
      if (a.mode === "pause" || a.mode === "rest") {
        if (roll < 0.22) {
          a.mode = "pause";
          a.until = rand(2.8, 8.5);
          a.drift.x = 0;
          a.drift.y = 0;
        } else if (roll < 0.72) {
          a.mode = "drift";
          a.until = rand(1.4, 4.2);
          const ang = rand(0, TWO_PI);
          const sp = rand(0.015, 0.045);
          a.drift.x = Math.cos(ang) * sp;
          a.drift.y = Math.sin(ang) * sp;
        } else if (!this.reducedMotion) {
          a.mode = "saccade";
          a.until = rand(0.09, 0.2);
          const ang = rand(0, TWO_PI);
          const sp = rand(0.35, 0.85);
          a.drift.x = Math.cos(ang) * sp;
          a.drift.y = Math.sin(ang) * sp;
          this.saccade = Math.min(1, this.saccade + 0.45);
        } else {
          a.mode = "pause";
          a.until = rand(2.8, 8.5);
          a.drift.x = 0;
          a.drift.y = 0;
        }
      } else {
        a.mode = Math.random() < 0.4 ? "pause" : "rest";
        a.until = rand(1.2, 4.5);
        a.drift.x = 0;
        a.drift.y = 0;
      }
    }

    if (this.gazeMode === "auto" && this.time >= this.inputQuietUntil) {
      this.eyeTarget.x += a.drift.x * dt * 6.5 + a.tremor.x;
      this.eyeTarget.y += a.drift.y * dt * 6.5 + a.tremor.y;
    } else {
      this.eyeTarget.x += a.tremor.x * 0.35;
      this.eyeTarget.y += a.tremor.y * 0.35;
    }
  }

  stepPressure(dt) {
    this.autoPhase += dt * (Math.PI * 2) / (this.reducedMotion ? 220 : 150);
    const wave = 0.5 + 0.5 * Math.sin(this.autoPhase);
    const eased = wave * wave * (3 - 2 * wave);
    this.autoPressure = eased;
    if (this.time >= this.manualUntil) {
      this.pressure += (this.autoPressure - this.pressure) * (1 - Math.exp(-dt * 0.35));
    }
    this.pressureDisplay += (this.pressure - this.pressureDisplay) * (1 - Math.exp(-dt * 2.4));
  }

  step(dt) {
    dt = clamp(dt, 0, 1 / 20);
    this.time += dt;
    this.stepAutoGaze(dt);
    this.stepPressure(dt);

    const k = 1 - Math.exp(-dt * 3.2);
    this.eye.x += (this.eyeTarget.x - this.eye.x) * k;
    this.eye.y += (this.eyeTarget.y - this.eye.y) * k;
    this.eyeTarget.x *= Math.exp(-dt * 2.1);
    this.eyeTarget.y *= Math.exp(-dt * 2.1);

    const follow = 1 - Math.exp(-dt * 1.15);
    this.fluid.x += (-this.eye.x * 0.85 - this.fluid.x) * follow;
    this.fluid.y += (-this.eye.y * 0.85 - this.fluid.y) * follow;

    this.saccade *= Math.exp(-dt * 2.8);

    const damp = Math.exp(-dt * 0.55);
    const visc = 1 - Math.exp(-dt * 2.4);
    const gravity = 0.011;
    const morphK = 1 - Math.exp(-dt * 0.12);

    for (const floater of this.floaters) {
      floater.morph += dt * floater.morphSpeed;
      const pts = floater.points;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const ang = floater.morph + p.phase;
        p.restX += Math.cos(ang * 0.7) * 0.00035;
        p.restY += Math.sin(ang * 0.55) * 0.00028;
        p.vx += (this.fluid.x - p.vx) * visc;
        p.vy += (this.fluid.y - p.vy) * visc;
        p.vy -= gravity * dt;
        p.vx += (p.restX - p.x) * 0.12 * dt;
        p.vy += (p.restY - p.y) * 0.12 * dt;
        p.vx *= damp;
        p.vy *= damp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.restX += (p.x - p.restX) * morphK * 0.04;
        p.restY += (p.y - p.restY) * morphK * 0.04;
      }

      const iters = 4;
      for (let it = 0; it < iters; it++) {
        const n = pts.length;
        const last = floater.closed ? n : n - 1;
        for (let i = 0; i < last; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % n];
          let rest = floater.rest[i];
          rest *= 1 + 0.04 * Math.sin(floater.morph + i * 0.4);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 1e-6;
          const diff = (dist - rest) / dist * 0.5;
          a.x += dx * diff;
          a.y += dy * diff;
          b.x -= dx * diff;
          b.y -= dy * diff;
        }
      }

      for (const p of pts) {
        const limX = this.aspect * 0.94;
        if (p.x < -limX) {
          p.x = -limX;
          p.vx *= -0.15;
        } else if (p.x > limX) {
          p.x = limX;
          p.vx *= -0.15;
        }
        if (p.y < -0.78) p.vy += 0.035 * dt;
        if (p.y < -0.94) {
          p.y = -0.94;
          p.vy *= 0.15;
        } else if (p.y > 0.94) {
          p.y = 0.94;
          p.vy *= -0.2;
        }
      }
    }
  }

  writeSegments(out) {
    let n = 0;
    const stride = 8;
    const max = (out.length / stride) | 0;
    for (const floater of this.floaters) {
      const pts = floater.points;
      const last = floater.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < last; i++) {
        if (n >= max) return n;
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const o = n * stride;
        out[o] = a.x;
        out[o + 1] = a.y;
        out[o + 2] = b.x;
        out[o + 3] = b.y;
        out[o + 4] = (a.radius + b.radius) * 0.5;
        out[o + 5] = floater.density;
        out[o + 6] = 0;
        out[o + 7] = 0;
        n += 1;
      }
    }
    return n;
  }
}

export { clamp, rand };
