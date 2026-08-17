import { Simulation } from "./simulation.js";
import { Renderer } from "./renderer.js";
import { Input } from "./input.js";
import { UI } from "./ui.js";

const fallback = document.getElementById("fallback");

function showFallback() {
  fallback.hidden = false;
}

async function start() {
  const sim = new Simulation();
  const renderer = new Renderer();
  try {
    await renderer.init();
  } catch (err) {
    console.error(err);
    showFallback();
    return;
  }

  const input = new Input(renderer.canvas, sim, () => ui?.scheduleHide());
  const ui = new UI(sim, input);

  window.addEventListener("pagehide", () => input.dispose());
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    input.sampleGaze();
    sim.step(dt);
    ui.sync();
    const count = sim.writeSegments(renderer.segmentData);
    renderer.frame(sim, dt, count);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

start();
