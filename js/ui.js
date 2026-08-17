export class UI {
  constructor(sim, input) {
    this.sim = sim;
    this.input = input;
    this.hud = document.getElementById("hud");
    this.info = document.getElementById("info");
    this.infoToggle = document.getElementById("info-toggle");
    this.infoClose = document.getElementById("info-close");
    this.slider = document.getElementById("pressure");
    this.gazeBtn = document.getElementById("gaze-toggle");
    this.motionBtn = document.getElementById("motion-toggle");
    this.hideTimer = 0;
    this.infoOpen = false;
    this.manualSlider = false;

    this.show = this.show.bind(this);
    this.scheduleHide = this.scheduleHide.bind(this);

    this.infoToggle.addEventListener("click", () => this.toggleInfo(true));
    this.infoClose.addEventListener("click", () => this.toggleInfo(false));
    this.info.addEventListener("click", (e) => {
      if (e.target === this.info) this.toggleInfo(false);
    });

    this.slider.addEventListener("pointerdown", () => {
      this.manualSlider = true;
      this.show();
    });
    this.slider.addEventListener("input", () => {
      this.sim.setPressure(Number(this.slider.value), true);
      this.show();
    });
    this.slider.addEventListener("pointerup", () => {
      this.manualSlider = false;
    });
    this.slider.addEventListener("change", () => {
      this.manualSlider = false;
    });

    this.gazeBtn.addEventListener("click", () => this.toggleGaze());
    this.motionBtn.addEventListener("click", () => this.toggleMotion());

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.toggleInfo(false);
      if (e.key === "i" || e.key === "I" || e.key === "?") {
        this.toggleInfo(!this.infoOpen);
      }
      if (e.key === "ArrowLeft") {
        this.sim.setPressure(this.sim.pressure - 0.04, true);
        this.show();
      }
      if (e.key === "ArrowRight") {
        this.sim.setPressure(this.sim.pressure + 0.04, true);
        this.show();
      }
    });

    this.show();
  }

  show() {
    this.hud.classList.add("is-visible");
    clearTimeout(this.hideTimer);
    if (!this.infoOpen) this.hideTimer = setTimeout(() => this.hide(), 3200);
  }

  hide() {
    if (this.infoOpen) return;
    this.hud.classList.remove("is-visible");
  }

  scheduleHide() {
    this.show();
  }

  toggleInfo(open) {
    this.infoOpen = open;
    this.info.hidden = !open;
    this.infoToggle.setAttribute("aria-expanded", String(open));
    if (open) {
      this.hud.classList.add("is-visible");
      clearTimeout(this.hideTimer);
    } else {
      this.show();
    }
  }

  async toggleGaze() {
    try {
      const on = await this.input.toggleGaze();
      this.gazeBtn.setAttribute("aria-pressed", String(on));
    } catch (err) {
      this.gazeBtn.setAttribute("aria-pressed", "false");
      this.gazeBtn.title = err.message || "Gaze unavailable";
    }
    this.show();
  }

  async toggleMotion() {
    try {
      const on = await this.input.toggleMotion();
      this.motionBtn.setAttribute("aria-pressed", String(on));
    } catch (err) {
      this.motionBtn.setAttribute("aria-pressed", "false");
      this.motionBtn.title = err.message || "Motion unavailable";
    }
    this.show();
  }

  sync() {
    if (!this.manualSlider && document.activeElement !== this.slider) {
      this.slider.value = String(this.sim.pressureDisplay);
    }
  }
}
