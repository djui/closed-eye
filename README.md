# Closed-Eye

An interactive WebGPU artwork of looking inward: the living grain of closed-eye vision, the slow colour of light through eyelids, and a few defocused fibres drifting in the vitreous.

It is meant to feel organic, intimate and slightly hypnagogic — biological observation, meditation, and the edge of sleep — not a screensaver and not a particle demo.

## Run

Serve the folder over HTTP (modules and WebGPU are not reliable from `file://`):

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`. A recent Chrome, Edge, or Safari with GPU access is required. There is no WebGL fallback.

## Interact

- **Drag / swipe** — suggest a glance. The field is viscous; motion continues after you let go.
- **Eyelid pressure** — walks the colour of the field from pale sky blue through green, yellow and orange into deep retinal red. It travels on its own, pauses while you adjust it, then resumes.
- **gaze** — optional front camera. A lightweight brightness tracker follows dark eye regions when lighting allows.
- **motion** — optional phone orientation / acceleration, standing in for the turning globe.
- Without sensors, the piece generates slow drifts, small flicks and quiet pauses on its own.
- **i** — notes on the physics and psychology. The rest of the interface fades when you leave it alone.

## What it is modelling

Closed eyelids do not produce a blank. Daylight is filtered by skin and haemoglobin into a retinal red; darkness leaves *eigenlicht*, a pale blue-grey of spontaneous photoreceptor noise. That noise is not a frozen texture: points flicker, drift and die.

Floaters (*muscae volitantes*) are collagen condensates in the vitreous. The gel lags behind eye rotation, so they overshoot a glance and then settle under very weak gravity. Because they hang in front of the retina, their shadows are optically defocused — a dark core with a faint inverted halo — not a double image.

The rendering is WebGPU only: a time-varying scintillation field, capsule-splatted fibres, and a difference-of-Gaussians optical profile.
