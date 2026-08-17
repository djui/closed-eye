export const PRESENT_FORMATS = ["bgra8unorm", "rgba8unorm"];

export const COMMON = /* wgsl */ `
struct Uniforms {
  resolution: vec2f,
  time: f32,
  dt: f32,
  pressure: f32,
  persistence: f32,
  eye_vel: vec2f,
  saccade: f32,
  quality: f32,
  aspect: f32,
  motion: f32,
  _pad: f32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

fn value_noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u2 = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u2.x), mix(c, d, u2.x), u2.y);
}

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var x = p;
  for (var i = 0; i < 5; i++) {
    v += a * value_noise(x);
    x = x * 2.03 + vec2f(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}

fn curl(p: vec2f) -> vec2f {
  let e = 0.12;
  let n1 = value_noise(p + vec2f(0.0, e));
  let n2 = value_noise(p - vec2f(0.0, e));
  let n3 = value_noise(p + vec2f(e, 0.0));
  let n4 = value_noise(p - vec2f(e, 0.0));
  return vec2f(n1 - n2, n4 - n3);
}

fn eyelid_color(t: f32) -> vec3f {
  // pale sky blue → green → yellow → orange → deep retinal red
  let c0 = vec3f(0.70, 0.82, 0.92);
  let c1 = vec3f(0.42, 0.66, 0.56);
  let c2 = vec3f(0.78, 0.72, 0.34);
  let c3 = vec3f(0.82, 0.42, 0.18);
  let c4 = vec3f(0.48, 0.07, 0.055);
  let t1 = smoothstep(0.0, 1.0, t / 0.28);
  let t2 = smoothstep(0.0, 1.0, (t - 0.22) / 0.28);
  let t3 = smoothstep(0.0, 1.0, (t - 0.46) / 0.28);
  let t4 = smoothstep(0.0, 1.0, (t - 0.70) / 0.30);
  var c = mix(c0, c1, t1);
  c = mix(c, c2, t2);
  c = mix(c, c3, t3);
  c = mix(c, c4, t4);
  return c;
}

fn to_srgb(c: vec3f) -> vec3f {
  return pow(max(c, vec3f(0.0)), vec3f(0.4545));
}
`;

export const FULLSCREEN_VS = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var out: VSOut;
  let pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  let p = pos[vi];
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = p * 0.5 + 0.5;
  return out;
}
`;

export const FIELD_FS = /* wgsl */ `
@group(0) @binding(1) var prev_tex: texture_2d<f32>;
@group(0) @binding(2) var prev_samp: sampler;

fn grain(p: vec2f, t: f32, pressure: f32) -> f32 {
  let scale = mix(42.0, 28.0, pressure) * mix(0.82, 1.0, u.quality);
  let warp = vec2f(
    value_noise(p * 1.65 + vec2f(t * 0.019, 4.2)),
    value_noise(p * 1.65 + vec2f(8.1, -t * 0.016))
  );
  let g = p * scale + (warp - 0.5) * 0.7;
  let cell = floor(g);
  let f = fract(g);
  var acc = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let id = cell + vec2f(f32(i), f32(j));
      let rnd = hash22(id);
      let life = hash21(id + 19.0);
      let freq = mix(0.22, 1.85, hash21(id + 4.2));
      let phase = fract(t * freq * mix(0.18, 1.0, life) + life);
      let pulse = smoothstep(0.0, 0.05, phase) * smoothstep(0.32, 0.09, phase);
      let twinkle = pow(max(pulse, 0.0), 1.15) * mix(0.22, 1.0, hash21(id + 8.0));
      let drift = vec2f(
        sin(t * 0.053 + life * 6.2832),
        cos(t * 0.041 + rnd.x * 6.2832)
      ) * 0.28;
      let pos = vec2f(f32(i), f32(j)) + rnd + drift;
      var dlt = f - pos;
      let ang = hash21(id + 13.0) * 6.2832;
      let ca = cos(ang);
      let sa = sin(ang);
      dlt = vec2f(ca * dlt.x - sa * dlt.y, sa * dlt.x + ca * dlt.y);
      dlt.x *= mix(1.0, 1.9, hash21(id + 21.0));
      let rad = mix(0.018, 0.078, hash21(id + 11.7));
      let speckle = exp(-dot(dlt, dlt) / (rad * rad));
      acc += speckle * twinkle;
    }
  }
  return acc * mix(0.62, 0.28, pressure);
}

fn motes(p: vec2f, t: f32) -> f32 {
  let scale = 9.4;
  let flow = curl(p * 0.85 + vec2f(t * 0.021, t * -0.017)) * 0.55;
  let g = (p - flow * 1.8 - vec2f(t * 0.018, -t * 0.011)) * scale;
  let cell = floor(g);
  let f = fract(g);
  var acc = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let id = cell + vec2f(f32(i), f32(j));
      let rnd = hash22(id * 1.73);
      if (hash21(id + 2.2) > 0.38) { continue; }
      let life = hash21(id + 7.0);
      let phase = fract(t * mix(0.07, 0.22, life) + life);
      let pulse = 0.35 + 0.65 * smoothstep(0.0, 0.15, phase) * smoothstep(1.0, 0.55, phase);
      let pos = vec2f(f32(i), f32(j)) + rnd;
      let dlt = f - pos;
      let rad = mix(0.045, 0.13, hash21(id + 5.5));
      let speckle = exp(-dot(dlt, dlt) / (rad * rad));
      acc += speckle * pulse * mix(0.35, 1.0, hash21(id + 15.0));
    }
  }
  return acc * 0.42;
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var p = (uv - 0.5) * vec2f(u.aspect, 1.0);
  p *= 1.0 + 0.035 * dot(p, p);

  let col = eyelid_color(u.pressure);
  let lum = mix(0.16, 0.55, pow(u.pressure, 0.85));
  var field = col * lum;

  let clouds = fbm(p * 1.25 + vec2f(u.time * 0.015, u.time * 0.011));
  let cloud_amt = mix(0.11, 0.045, u.pressure);
  field += col * (clouds - 0.48) * cloud_amt;
  field += col * (fbm(p * 0.45 - u.time * 0.008) - 0.5) * 0.05;

  let grain_col = mix(vec3f(0.82, 0.90, 1.0), col * 1.35, u.pressure);
  field += grain(p, u.time, u.pressure) * grain_col;

  let mote_col = mix(vec3f(0.95, 0.97, 1.0), col * 1.5, 0.55);
  field += motes(p, u.time) * mote_col * mix(0.85, 0.45, u.pressure);

  let flash = u.saccade * 0.07 * (0.6 + 0.4 * clouds);
  field += col * flash;

  let r = length(p);
  field *= 1.0 - smoothstep(0.52, 1.18, r) * 0.42;

  let smear = vec2f(u.eye_vel.x / max(u.aspect, 0.01), u.eye_vel.y) * 0.045 * u.motion;
  let prev = textureSample(prev_tex, prev_samp, uv - smear).rgb;
  let persist = mix(u.persistence, min(u.persistence + 0.08, 0.92), u.motion);
  field = mix(field, prev, persist);

  field = max(field, vec3f(0.0));
  return vec4f(field, 1.0);
}
`;

export const SPLAT_WGSL = /* wgsl */ `
struct Segment {
  a: vec2f,
  b: vec2f,
  radius: f32,
  density: f32,
  _pad: vec2f,
}

@group(0) @binding(1) var<storage, read> segments: array<Segment>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec2f,
  @location(1) @interpolate(flat) index: u32,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  var out: VSOut;
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let s = segments[ii];
  let dirv = s.b - s.a;
  let len = length(dirv);
  let dir = dirv / max(len, 1e-5);
  let nrm = vec2f(-dir.y, dir.x);
  let pad = s.radius * 7.0;
  let c = corners[vi];
  let local = dir * (c.x * (len * 0.5 + pad)) + nrm * (c.y * pad);
  let mid = 0.5 * (s.a + s.b);
  let world = mid + local;
  out.world = world;
  out.index = ii;
  out.pos = vec4f(world.x / u.aspect, world.y, 0.0, 1.0);
  return out;
}

fn dist_capsule(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let s = segments[in.index];
  let d = dist_capsule(in.world, s.a, s.b);
  let g = exp(- (d * d) / max(s.radius * s.radius, 1e-8));
  let alpha = g * s.density;
  return vec4f(alpha, 0.0, 0.0, alpha);
}
`;

export const BLUR_FS = /* wgsl */ `
@group(0) @binding(1) var src_tex: texture_2d<f32>;
@group(0) @binding(2) var src_samp: sampler;
@group(0) @binding(3) var<uniform> axis_scale: vec4f;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let px = axis_scale.xy;
  let dir = axis_scale.zw;
  let w = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  var acc = textureSample(src_tex, src_samp, uv) * w[0];
  for (var i = 1; i < 5; i++) {
    let o = dir * px * f32(i) * 1.15;
    acc += textureSample(src_tex, src_samp, uv + o) * w[i];
    acc += textureSample(src_tex, src_samp, uv - o) * w[i];
  }
  return acc;
}
`;

export const COMPOSITE_FS = /* wgsl */ `
@group(0) @binding(1) var field_tex: texture_2d<f32>;
@group(0) @binding(2) var dens_tex: texture_2d<f32>;
@group(0) @binding(3) var blur_tex: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var field = textureSample(field_tex, samp, uv).rgb;
  let dens = textureSample(dens_tex, samp, uv).r;
  let blurred = textureSample(blur_tex, samp, uv).r;
  let hp = dens - blurred;

  let dark = max(hp, 0.0);
  let ring = max(-hp, 0.0);

  let col = eyelid_color(u.pressure);
  let pale = mix(vec3f(0.86, 0.92, 0.98), col * 1.25 + vec3f(0.18, 0.12, 0.08), u.pressure * 0.65);

  field *= 1.0 - clamp(dark * mix(1.55, 1.15, u.pressure), 0.0, 0.78);
  field += pale * ring * mix(2.15, 1.45, u.pressure);

  let r = length((uv - 0.5) * vec2f(u.aspect, 1.0));
  field *= 1.0 - smoothstep(0.72, 1.25, r) * 0.18;

  return vec4f(to_srgb(field), 1.0);
}
`;
