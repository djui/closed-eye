import {
  BLUR_FS,
  COMMON,
  COMPOSITE_FS,
  FIELD_FS,
  FULLSCREEN_VS,
  SPLAT_WGSL,
} from "./shaders.js";

const MAX_SEGMENTS = 256;
const UNIFORM_FLOATS = 16;

function isMobile() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 700;
}

function createBuffer(device, size, usage) {
  return device.createBuffer({ size, usage });
}

function createTexture(device, w, h, format, extra = 0) {
  return device.createTexture({
    size: { width: Math.max(1, w), height: Math.max(1, h) },
    format,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      extra,
  });
}

function compile(device, label, code) {
  const module = device.createShaderModule({ label, code });
  return module.getCompilationInfo().then((info) => {
    const errors = info.messages.filter((m) => m.type === "error");
    if (errors.length) {
      const text = errors
        .map((m) => `${m.lineNum}:${m.linePos} ${m.message}`)
        .join("\n");
      throw new Error(`${label} WGSL\n${text}`);
    }
    return module;
  });
}

export class Renderer {
  constructor() {
    this.canvas = document.getElementById("field");
    this.device = null;
    this.context = null;
    this.format = null;
    this.sampler = null;
    this.uniformBuffer = null;
    this.segmentBuffer = null;
    this.uniformData = new Float32Array(UNIFORM_FLOATS);
    this.segmentData = new Float32Array(MAX_SEGMENTS * 8);
    this.pipelines = {};
    this.layouts = {};
    this.field = [null, null];
    this.fieldView = [null, null];
    this.density = null;
    this.blurA = null;
    this.blurB = null;
    this.fieldIndex = 0;
    this.size = { w: 0, h: 0 };
    this.quality = 1;
    this.reducedMotion = false;
  }

  async init() {
    if (!navigator.gpu) throw new Error("WebGPU is not available.");
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) throw new Error("No WebGPU adapter.");
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => {
      console.warn("WebGPU device lost", info);
    });
    this.context = this.canvas.getContext("webgpu");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.quality = isMobile() ? 0.5 : 1;
    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.uniformBuffer = createBuffer(
      this.device,
      256,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    );
    this.segmentBuffer = createBuffer(
      this.device,
      MAX_SEGMENTS * 32,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    this.blurUniformH = createBuffer(
      this.device,
      256,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    );
    this.blurUniformV = createBuffer(
      this.device,
      256,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    );
    await this.createPipelines();
    this.resize();
  }

  async createPipelines() {
    const d = this.device;
    const fieldMod = await compile(d, "field", FULLSCREEN_VS + COMMON + FIELD_FS);
    const splatMod = await compile(d, "splat", COMMON + SPLAT_WGSL);
    const blurMod = await compile(d, "blur", FULLSCREEN_VS + COMMON + BLUR_FS);
    const compMod = await compile(d, "composite", FULLSCREEN_VS + COMMON + COMPOSITE_FS);

    this.layouts.field = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    this.layouts.splat = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
      ],
    });
    this.layouts.blur = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    this.layouts.composite = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });

    const fieldLayout = d.createPipelineLayout({ bindGroupLayouts: [this.layouts.field] });
    const splatLayout = d.createPipelineLayout({ bindGroupLayouts: [this.layouts.splat] });
    const blurLayout = d.createPipelineLayout({ bindGroupLayouts: [this.layouts.blur] });
    const compLayout = d.createPipelineLayout({ bindGroupLayouts: [this.layouts.composite] });

    this.pipelines.field = d.createRenderPipeline({
      label: "field",
      layout: fieldLayout,
      vertex: { module: fieldMod, entryPoint: "vs" },
      fragment: {
        module: fieldMod,
        entryPoint: "fs",
        targets: [{ format: "rgba8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.pipelines.splat = d.createRenderPipeline({
      label: "splat",
      layout: splatLayout,
      vertex: { module: splatMod, entryPoint: "vs" },
      fragment: {
        module: splatMod,
        entryPoint: "fs",
        targets: [
          {
            format: "rgba8unorm",
            blend: {
              color: { srcFactor: "one", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });

    this.pipelines.blur = d.createRenderPipeline({
      label: "blur",
      layout: blurLayout,
      vertex: { module: blurMod, entryPoint: "vs" },
      fragment: {
        module: blurMod,
        entryPoint: "fs",
        targets: [{ format: "rgba8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.pipelines.composite = d.createRenderPipeline({
      label: "composite",
      layout: compLayout,
      vertex: { module: compMod, entryPoint: "vs" },
      fragment: {
        module: compMod,
        entryPoint: "fs",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.splatBind = d.createBindGroup({
      layout: this.layouts.splat,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.segmentBuffer } },
      ],
    });
  }

  resize() {
    const cap = isMobile() ? 1280 : 1920;
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile() ? 1.5 : 2);
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const scale = Math.min(1, cap / Math.max(cssW * dpr, cssH * dpr));
    const w = Math.max(1, Math.round(cssW * dpr * scale));
    const h = Math.max(1, Math.round(cssH * dpr * scale));
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.canvas.width = w;
    this.canvas.height = h;
    this.rebuildTargets();
  }

  destroyTex(tex) {
    tex?.destroy();
  }

  rebuildTargets() {
    if (!this.device) return;
    this.destroyTex(this.field[0]);
    this.destroyTex(this.field[1]);
    this.destroyTex(this.density);
    this.destroyTex(this.blurA);
    this.destroyTex(this.blurB);
    const { w, h } = this.size;
    const dw = Math.max(1, Math.round(w * 0.55));
    const dh = Math.max(1, Math.round(h * 0.55));
    this.field[0] = createTexture(this.device, w, h, "rgba8unorm");
    this.field[1] = createTexture(this.device, w, h, "rgba8unorm");
    this.fieldView[0] = this.field[0].createView();
    this.fieldView[1] = this.field[1].createView();
    this.density = createTexture(this.device, dw, dh, "rgba8unorm");
    this.blurA = createTexture(this.device, dw, dh, "rgba8unorm");
    this.blurB = createTexture(this.device, dw, dh, "rgba8unorm");
    this.densityView = this.density.createView();
    this.blurAView = this.blurA.createView();
    this.blurBView = this.blurB.createView();
    this.densSize = { w: dw, h: dh };
    this.fieldIndex = 0;
    this.bindField = [
      this.device.createBindGroup({
        layout: this.layouts.field,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: this.fieldView[0] },
          { binding: 2, resource: this.sampler },
        ],
      }),
      this.device.createBindGroup({
        layout: this.layouts.field,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: this.fieldView[1] },
          { binding: 2, resource: this.sampler },
        ],
      }),
    ];
    const scale = 2.6;
    const hx = (1 / dw) * scale;
    const hy = (1 / dh) * scale;
    this.device.queue.writeBuffer(this.blurUniformH, 0, new Float32Array([hx, hy, 1, 0]));
    this.device.queue.writeBuffer(this.blurUniformV, 0, new Float32Array([hx, hy, 0, 1]));
    this.bindBlurH = this.device.createBindGroup({
      layout: this.layouts.blur,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.densityView },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.blurUniformH } },
      ],
    });
    this.bindBlurV = this.device.createBindGroup({
      layout: this.layouts.blur,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.blurAView },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.blurUniformV } },
      ],
    });
    this.bindComposite = [
      this.device.createBindGroup({
        layout: this.layouts.composite,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: this.fieldView[0] },
          { binding: 2, resource: this.densityView },
          { binding: 3, resource: this.blurBView },
          { binding: 4, resource: this.sampler },
        ],
      }),
      this.device.createBindGroup({
        layout: this.layouts.composite,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: this.fieldView[1] },
          { binding: 2, resource: this.densityView },
          { binding: 3, resource: this.blurBView },
          { binding: 4, resource: this.sampler },
        ],
      }),
    ];
    const clear = this.device.createCommandEncoder();
    for (const view of this.fieldView) {
      clear
        .beginRenderPass({
          colorAttachments: [
            {
              view,
              clearValue: { r: 0.07, g: 0.08, b: 0.1, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        })
        .end();
    }
    this.device.queue.submit([clear.finish()]);
  }

  writeUniforms(sim, dt) {
    const motion = Math.min(1, Math.hypot(sim.eye.x, sim.eye.y) * 1.8);
    const persist = this.reducedMotion ? 0.32 : 0.66;
    const u = this.uniformData;
    u[0] = this.size.w;
    u[1] = this.size.h;
    u[2] = sim.time;
    u[3] = dt;
    u[4] = sim.pressureDisplay;
    u[5] = persist;
    u[6] = sim.eye.x;
    u[7] = sim.eye.y;
    u[8] = sim.saccade;
    u[9] = this.quality;
    u[10] = sim.aspect;
    u[11] = motion;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, u);
  }

  blurPass(encoder, bindGroup, destView) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: destView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipelines.blur);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  frame(sim, dt, segmentCount) {
    this.resize();
    const aspect = this.size.w / this.size.h;
    sim.setAspect(aspect);
    this.writeUniforms(sim, dt);
    if (segmentCount > 0) {
      this.device.queue.writeBuffer(
        this.segmentBuffer,
        0,
        this.segmentData,
        0,
        segmentCount * 32
      );
    }

    const prev = this.fieldIndex;
    const curr = 1 - prev;
    const encoder = this.device.createCommandEncoder();

    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.fieldView[curr],
            clearValue: { r: 0.05, g: 0.04, b: 0.05, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(this.pipelines.field);
      pass.setBindGroup(0, this.bindField[prev]);
      pass.draw(3);
      pass.end();
    }

    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.densityView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      if (segmentCount > 0) {
        pass.setPipeline(this.pipelines.splat);
        pass.setBindGroup(0, this.splatBind);
        pass.draw(6, segmentCount);
      }
      pass.end();
    }

    this.blurPass(encoder, this.bindBlurH, this.blurAView);
    this.blurPass(encoder, this.bindBlurV, this.blurBView);

    const canvasView = this.context.getCurrentTexture().createView();
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: canvasView,
            clearValue: { r: 0.05, g: 0.03, b: 0.04, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(this.pipelines.composite);
      pass.setBindGroup(0, this.bindComposite[curr]);
      pass.draw(3);
      pass.end();
    }

    this.device.queue.submit([encoder.finish()]);
    this.fieldIndex = curr;
  }
}
