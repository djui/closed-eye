export class Input {
  constructor(canvas, simulation, onUiActivity) {
    this.canvas = canvas;
    this.sim = simulation;
    this.onUiActivity = onUiActivity;
    this.pointer = null;
    this.gazeStream = null;
    this.gazeVideo = null;
    this.gazeCanvas = null;
    this.gazeCtx = null;
    this.prevGaze = null;
    this.motionEnabled = false;
    this.lastOrient = null;
    this.orientHandler = null;
    this.motionHandler = null;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onActivity = this.onActivity.bind(this);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("mousemove", this.onActivity);
    window.addEventListener("touchstart", this.onActivity, { passive: true });
    window.addEventListener("keydown", this.onActivity);
  }

  onActivity() {
    this.onUiActivity?.();
  }

  onPointerDown(e) {
    if (e.target !== this.canvas) return;
    this.pointer = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.canvas.setPointerCapture?.(e.pointerId);
    this.onActivity();
  }

  onPointerMove(e) {
    if (!this.pointer) return;
    const now = performance.now();
    const dt = Math.max((now - this.pointer.t) / 1000, 1 / 120);
    const dx = (e.clientX - this.pointer.x) / window.innerWidth;
    const dy = (e.clientY - this.pointer.y) / window.innerHeight;
    this.sim.impulse(dx / dt * 0.18, -dy / dt * 0.18);
    this.sim.gazeMode = "pointer";
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.t = now;
    this.onActivity();
  }

  onPointerUp() {
    this.pointer = null;
    if (!this.gazeStream && !this.motionEnabled) {
      this.sim.gazeMode = "auto";
    }
  }

  async toggleGaze() {
    if (this.gazeStream) {
      this.stopGaze();
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera is not available.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
      audio: false,
    });
    this.gazeStream = stream;
    this.gazeVideo = document.createElement("video");
    this.gazeVideo.srcObject = stream;
    this.gazeVideo.playsInline = true;
    this.gazeVideo.muted = true;
    await this.gazeVideo.play();
    this.gazeCanvas = document.createElement("canvas");
    this.gazeCanvas.width = 80;
    this.gazeCanvas.height = 60;
    this.gazeCtx = this.gazeCanvas.getContext("2d", { willReadFrequently: true });
    this.prevGaze = null;
    this.sim.gazeMode = "gaze";
    return true;
  }

  stopGaze() {
    this.gazeStream?.getTracks().forEach((t) => t.stop());
    this.gazeStream = null;
    this.gazeVideo = null;
    this.gazeCanvas = null;
    this.gazeCtx = null;
    this.prevGaze = null;
    if (!this.motionEnabled && !this.pointer) this.sim.gazeMode = "auto";
  }

  sampleGaze() {
    if (!this.gazeCtx || !this.gazeVideo || this.gazeVideo.readyState < 2) return;
    const ctx = this.gazeCtx;
    const w = this.gazeCanvas.width;
    const h = this.gazeCanvas.height;
    ctx.drawImage(this.gazeVideo, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h).data;

    let sx = 0;
    let sy = 0;
    let sw = 0;
    const y0 = (h * 0.18) | 0;
    const y1 = (h * 0.62) | 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lum = img[i] * 0.3 + img[i + 1] * 0.59 + img[i + 2] * 0.11;
        const weight = lum < 70 ? (70 - lum) : 0;
        if (weight <= 0) continue;
        sx += x * weight;
        sy += y * weight;
        sw += weight;
      }
    }
    if (sw < 8) return;
    const gx = sx / sw / w;
    const gy = sy / sw / h;
    if (this.prevGaze) {
      const dx = gx - this.prevGaze.x;
      const dy = gy - this.prevGaze.y;
      if (Math.hypot(dx, dy) > 0.0008) {
        this.sim.impulse(-dx * 4.2, dy * 4.2);
        this.sim.gazeMode = "gaze";
      }
    }
    this.prevGaze = { x: gx, y: gy };
  }

  async toggleMotion() {
    if (this.motionEnabled) {
      this.stopMotion();
      return false;
    }
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      const perm = await DOE.requestPermission();
      if (perm !== "granted") throw new Error("Motion permission was not granted.");
    }
    this.orientHandler = (e) => this.onOrientation(e);
    this.motionHandler = (e) => this.onMotion(e);
    window.addEventListener("deviceorientation", this.orientHandler);
    window.addEventListener("devicemotion", this.motionHandler);
    this.motionEnabled = true;
    this.sim.gazeMode = "motion";
    this.lastOrient = null;
    return true;
  }

  stopMotion() {
    if (this.orientHandler) window.removeEventListener("deviceorientation", this.orientHandler);
    if (this.motionHandler) window.removeEventListener("devicemotion", this.motionHandler);
    this.orientHandler = null;
    this.motionHandler = null;
    this.motionEnabled = false;
    this.lastOrient = null;
    if (!this.gazeStream && !this.pointer) this.sim.gazeMode = "auto";
  }

  onOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    const beta = e.beta;
    const gamma = e.gamma;
    if (this.lastOrient) {
      let db = beta - this.lastOrient.beta;
      let dg = gamma - this.lastOrient.gamma;
      if (Math.abs(db) > 30) db = 0;
      if (Math.abs(dg) > 30) dg = 0;
      this.sim.impulse(dg * 0.045, -db * 0.045);
      this.sim.gazeMode = "motion";
    }
    this.lastOrient = { beta, gamma };
  }

  onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const ax = (a.x || 0) * 0.008;
    const ay = (a.y || 0) * 0.008;
    if (Math.hypot(ax, ay) > 0.002) {
      this.sim.impulse(ax, -ay);
    }
  }

  dispose() {
    this.stopGaze();
    this.stopMotion();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("mousemove", this.onActivity);
    window.removeEventListener("touchstart", this.onActivity);
    window.removeEventListener("keydown", this.onActivity);
  }
}
