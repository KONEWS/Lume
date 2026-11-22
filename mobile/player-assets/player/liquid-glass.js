/* Lens is MIT licensed. See lens/LICENSE. Built by scripts/build-mobile-glass.mjs. */
"use strict";
(() => {
  // src/appearance/drag-range.js
  function paintRangeValue(input, value) {
    const min = Number(input.min || 0), max = Number(input.max || 100);
    const next = Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
    input.value = String(next);
    const displayed = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : next;
    const fraction = max > min ? (displayed - min) / (max - min) : 0;
    const rail = input.closest(".liquid-range");
    if (rail) {
      rail.style.setProperty("--progress", fraction * 100 + "%");
      rail.style.setProperty("--thumb-offset", (0.5 - fraction) * Number(input.dataset.thumbWidth || 0) + "px");
    }
    return displayed;
  }
  function bindRangeDrag(input, preview, commit, cancel) {
    const events = new AbortController();
    const options = { signal: events.signal };
    let pointerId = null;
    const read = (e) => {
      const rect = input.getBoundingClientRect();
      const inset = Number(input.dataset.thumbWidth || 0) / 2;
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left - inset) / Math.max(1, rect.width - 2 * inset)));
      const min = Number(input.min), max = Number(input.max), step = Number(input.step) || 1;
      return Math.max(min, Math.min(max, Number((min + Math.round(fraction * (max - min) / step) * step).toFixed(5))));
    };
    function show(e) {
      const v = paintRangeValue(input, read(e));
      preview(v);
      return v;
    }
    function release(id) {
      if (input.hasPointerCapture(id)) input.releasePointerCapture(id);
    }
    input.addEventListener("pointerdown", (e) => {
      if (pointerId !== null || input.disabled || !e.isPrimary || e.button !== 0) return;
      e.preventDefault();
      pointerId = e.pointerId;
      input.dataset.tracking = "";
      input.focus({ preventScroll: true });
      input.setPointerCapture(e.pointerId);
      show(e);
    }, options);
    input.addEventListener("pointermove", (e) => {
      if (pointerId === e.pointerId) show(e);
    }, options);
    input.addEventListener("pointerup", (e) => {
      if (pointerId !== e.pointerId) return;
      const v = show(e);
      pointerId = null;
      delete input.dataset.tracking;
      release(e.pointerId);
      commit(v);
    }, options);
    function abort() {
      if (pointerId === null) return;
      const id = pointerId;
      pointerId = null;
      delete input.dataset.tracking;
      release(id);
      cancel();
    }
    input.addEventListener("lostpointercapture", abort, options);
    input.addEventListener("pointercancel", abort, options);
    window.addEventListener("blur", abort, options);
    input.addEventListener("contextmenu", (e) => e.preventDefault(), options);
    return () => {
      events.abort();
      if (pointerId !== null) release(pointerId);
      pointerId = null;
      delete input.dataset.tracking;
    };
  }

  // src/appearance/lens/internal/jelly-physics.js
  var clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  var Spring = class {
    constructor(value = 0) {
      this.value = value;
      this.velocity = 0;
      this.target = value;
    }
    step(dt, stiffness = 220, damping = 20) {
      let remaining = Math.min(Math.max(dt, 0), 0.08);
      while (remaining > 0) {
        const h = Math.min(remaining, 1 / 180);
        this.velocity += ((this.target - this.value) * stiffness - this.velocity * damping) * h;
        this.value += this.velocity * h;
        remaining -= h;
      }
      if (Math.abs(this.velocity) < 0.025 && Math.abs(this.target - this.value) < 5e-3) {
        this.value = this.target;
        this.velocity = 0;
      }
      return this.value;
    }
    snap(value = this.target) {
      this.value = this.target = value;
      this.velocity = 0;
    }
    get moving() {
      return Math.abs(this.velocity) > 0.025 || Math.abs(this.target - this.value) > 5e-3;
    }
  };
  function jellyMatrix(stretch, angle, lift = 1) {
    const along = 1 + clamp(stretch, -0.2, 0.34), across = 1 / along;
    const c = Math.cos(angle), s = Math.sin(angle);
    return [
      (along * c * c + across * s * s) * lift,
      (along - across) * c * s * lift,
      (along - across) * c * s * lift,
      (along * s * s + across * c * c) * lift
    ];
  }
  function boundDrag(x, y, box, viewport, padding = 16) {
    return {
      x: clamp(x, padding - box.left, viewport.width - padding - box.right),
      y: clamp(y, padding - box.top, viewport.height - padding - box.bottom)
    };
  }
  function togglePose(position, travel, size, pressure = 0, stretch = 0) {
    const scaleX = 1 + clamp(pressure * 0.1 + stretch, 0, Math.min(0.18, travel / Math.max(size, 1)));
    const extra = (scaleX - 1) * size / 2;
    return { x: clamp(position, extra, Math.max(extra, travel - extra)), scaleX, scaleY: 1 / scaleX };
  }

  // src/appearance/capsule-spring.js
  var CapsuleSpring = class {
    constructor(surface, invalidate) {
      this.surface = surface;
      this.words = [...surface.closest("nav").querySelectorAll("[data-lens-word]")].map((word) => {
        const letters = Array.from(word.textContent, (character) => {
          const letter = document.createElement("span");
          letter.textContent = character;
          return letter;
        });
        word.replaceChildren(...letters);
        return { word, letters };
      });
      this.invalidate = invalidate;
      this.press = new Spring();
      this.trail = new Spring();
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
      this.frame = 0;
      this.advance = this.advance.bind(this);
    }
    hold() {
      this.press.snap(this.reduced.matches ? 0 : 1);
      this.paint();
      this.wake();
    }
    pull(distance, speed, width) {
      const strain = clamp(Math.abs(distance) / Math.max(1, width), 0, 1);
      const lag = Math.min(0.32, 0.23 * strain + 0.1 * Math.min(1, Math.abs(speed) / 800));
      this.trail.target = -Math.sign(distance) * lag * width * 0.25;
      this.wake();
    }
    release() {
      this.press.target = this.trail.target = 0;
      this.wake();
    }
    wake() {
      if (this.frame) return;
      this.previous = performance.now();
      this.frame = requestAnimationFrame(this.advance);
    }
    advance(now) {
      const dt = (now - this.previous) / 1e3;
      this.previous = now;
      this.frame = 0;
      if (this.reduced.matches || !this.surface.isConnected) {
        this.press.snap(0);
        this.trail.snap(0);
      } else {
        this.press.step(dt, 240, 20);
        this.trail.step(dt, 265, 18);
      }
      this.paint();
      const travelling = this.press.target && this.surface.parentElement?.getAnimations().some((animation) => animation.playState === "running");
      if (this.press.moving || this.trail.moving || travelling) this.frame = requestAnimationFrame(this.advance);
    }
    paint() {
      const length = 1 + 0.42 * this.press.value;
      const height = 1 + 0.44 * this.press.value;
      this.surface.style.transform = "matrix(" + [length, 0, 0, height, this.trail.value, 0].join(",") + ")";
      this.refractLetters(clamp(this.press.value, 0, 1));
      this.invalidate(0);
    }
    refractLetters(strength) {
      const box = this.surface.getBoundingClientRect();
      const radius = Math.max(1, box.width / 2);
      const center = box.left + radius;
      const offsets = this.words.map(({ word, letters }) => {
        const left = word.getBoundingClientRect().left;
        return letters.map((letter) => (left + letter.offsetLeft + letter.offsetWidth / 2 - center) / radius);
      });
      this.words.forEach(({ letters }, i) => letters.forEach((letter, j) => {
        const x = offsets[i][j];
        const lens = Math.max(0, 1 - x * x) * strength;
        if (!lens) {
          if (letter.style.transform) letter.style.removeProperty("transform");
          return;
        }
        letter.style.transform = `matrix(${1 + 0.09 * lens},0,${0.13 * x * lens},${1 + 0.13 * lens},${4 * x * lens},${-1.25 * lens})`;
      }));
    }
  };

  // src/appearance/selection-motion.js
  function installSelectionMotion(stage, invalidate) {
    let frame = 0, gesture = null, swallowClick = null;
    const observed = /* @__PURE__ */ new Set();
    const springs = /* @__PURE__ */ new WeakMap();
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(layout);
    };
    const resize = new ResizeObserver(schedule);
    function layout() {
      frame = 0;
      const groups = stage.querySelectorAll("[data-lens-group]");
      for (const group of observed) if (!group.isConnected) {
        resize.unobserve(group);
        observed.delete(group);
      }
      for (const group of groups) {
        if (gesture?.group === group && gesture.moved) continue;
        if (!observed.has(group)) {
          resize.observe(group);
          observed.add(group);
        }
        const marker = group.querySelector("[data-lens-position], [data-lens-marker]");
        const active = gesture?.spring && gesture.group === group ? gesture.button : group.querySelector("button:is([aria-current=page],[aria-pressed=true],.selected)");
        if (!marker) continue;
        if (!active || !active.offsetWidth) {
          marker.hidden = true;
          continue;
        }
        const left = active.offsetLeft, top = active.offsetTop;
        const width = active.offsetWidth, height = active.offsetHeight;
        const key = [left, top, width, height].join(",");
        if (!marker.hidden && marker.dataset.position === key) continue;
        const first = marker.hidden || !marker.dataset.position;
        marker.hidden = false;
        if (first) marker.style.transition = "none";
        marker.dataset.position = key;
        marker.style.width = width + "px";
        marker.style.height = height + "px";
        marker.style.transform = "translate3d(" + left + "px," + top + "px,0)";
        if (first) {
          marker.getBoundingClientRect();
          marker.style.removeProperty("transition");
        }
        invalidate(first ? 0 : 520);
      }
    }
    stage.addEventListener("pointerdown", (event) => {
      const button = event.target.closest("[data-lens-group] > button");
      if (gesture || !button || button.disabled || !event.isPrimary || event.button !== 0) return;
      const group = button.parentElement;
      const buttons = [...group.querySelectorAll(":scope > button")].filter((b) => !b.disabled && b.offsetWidth);
      const marker = group.querySelector("[data-lens-position], [data-lens-marker]");
      if (!marker || buttons.length < 2) return;
      const vertical = Math.abs(buttons[1].offsetTop - buttons[0].offsetTop) > Math.abs(buttons[1].offsetLeft - buttons[0].offsetLeft);
      gesture = { id: event.pointerId, button, group, buttons, marker, vertical, start: vertical ? event.clientY : event.clientX, moved: false, target: button };
      const surface = marker.querySelector("[data-stretch-capsule]");
      if (surface) {
        if (!springs.has(surface)) springs.set(surface, new CapsuleSpring(surface, invalidate));
        gesture.spring = springs.get(surface);
        gesture.lastDelta = 0;
        gesture.lastTime = performance.now();
        if (frame) cancelAnimationFrame(frame);
        layout();
        gesture.spring.hold();
      }
      swallowClick = null;
      group.dataset.holding = "";
      button.setPointerCapture(event.pointerId);
    });
    stage.addEventListener("pointermove", (event) => {
      const g = gesture;
      if (!g || g.id !== event.pointerId) return;
      const delta = (g.vertical ? event.clientY : event.clientX) - g.start;
      if (!g.moved && Math.abs(delta) < 4) return;
      if (g.spring) {
        const now = performance.now();
        const speed = 1e3 * (delta - g.lastDelta) / Math.max(8, now - g.lastTime);
        g.spring.pull(delta, speed, g.button.offsetWidth);
        g.lastTime = now;
        g.lastDelta = delta;
      }
      g.moved = true;
      g.group.dataset.sliding = "";
      const pos = (b) => g.vertical ? b.offsetTop : b.offsetLeft;
      const origin = pos(g.button);
      const offset = Math.max(pos(g.buttons[0]), Math.min(pos(g.buttons[g.buttons.length - 1]), origin + delta));
      g.target = g.buttons.reduce((near, b) => Math.abs(pos(b) - offset) < Math.abs(pos(near) - offset) ? b : near);
      g.marker.style.width = g.button.offsetWidth + "px";
      g.marker.style.height = g.button.offsetHeight + "px";
      g.marker.style.transform = "translate3d(" + (g.vertical ? g.button.offsetLeft : offset) + "px," + (g.vertical ? offset : g.button.offsetTop) + "px,0)";
      invalidate(0);
    });
    function finish(event, commit) {
      const g = gesture;
      if (!g || event.pointerId !== void 0 && g.id !== event.pointerId) return;
      g.spring?.release();
      gesture = null;
      delete g.group.dataset.sliding;
      delete g.group.dataset.holding;
      if (!g.moved) {
        if (g.spring) schedule();
        return;
      }
      swallowClick = { group: g.group, until: performance.now() + 550 };
      g.marker.dataset.position = "dragged";
      if (commit) g.target.click();
      schedule();
    }
    stage.addEventListener("pointerup", (e) => finish(e, true));
    stage.addEventListener("pointercancel", (e) => finish(e, false));
    stage.addEventListener("lostpointercapture", (e) => finish(e, false));
    window.addEventListener("blur", (e) => finish(e, false));
    stage.addEventListener("click", (e) => {
      if (e.isTrusted && e.detail && swallowClick?.group.contains(e.target) && performance.now() < swallowClick.until) {
        e.preventDefault();
        e.stopImmediatePropagation();
        swallowClick = null;
      }
    }, true);
    stage.addEventListener("contextmenu", (e) => {
      if (e.target.closest("[data-lens-group]")) e.preventDefault();
    });
    new MutationObserver((records) => {
      if (records.some((r) => r.type === "childList" ? [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1 && (n.matches("[data-lens-group], [data-lens-group] button") || n.querySelector("[data-lens-group]"))) : r.target.matches("[data-lens-group] button") || r.attributeName === "hidden" && r.target.querySelector("[data-lens-group]"))) schedule();
    }).observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-current", "aria-pressed", "class", "hidden"] });
    schedule();
  }

  // src/appearance/lens/tokens.js
  var freezeTokens = (value) => {
    for (const item of Object.values(value)) if (item && typeof item === "object") freezeTokens(item);
    return Object.freeze(value);
  };
  var tokens = freezeTokens({
    version: "1.1.0-showcase.1",
    color: { text: "#22252b", muted: "#6b7079", accent: "#2875ed", focus: "#2576e8", page: "#f7f8fa", success: "#236442" },
    type: { family: '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', body: 16, control: 14, caption: 12 },
    space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
    radius: { chrome: 14, panel: 34, lens: 60, pill: 999 },
    surface: { fallback: "rgba(245,250,255,.30)", solid: "#eef2f8", shadow: "inset 0 1px 0 #fff9,inset 1px 0 0 #fff3,0 12px 24px -12px #2135524d" },
    motion: { elasticity: 0.7, spring: "cubic-bezier(.2,.9,.25,1.22)", fast: 160, normal: 240, feedback: 520 },
    optics: { gold: "#e2b54e", green: "#52bb83", light: "#90e8fa", flowDuration: 1100, settleDuration: 280, magnification: 1.8 },
    audio: { enabled: true, volume: 0.28, maxVoices: 6, cooldown: 70, storageKey: "lens.sound.v1" },
    materials: { clear: { refraction: 0.65, blur: 0.12, dispersion: 0.35 }, soft: { refraction: 0.38, blur: 0.64, dispersion: 0.12 }, thick: { refraction: 0.9, blur: 0.24, dispersion: 0.65 } }
  });
  var materialPresets = tokens.materials;

  // src/appearance/lens/internal/optics.js
  var opticalRecords = /* @__PURE__ */ new WeakMap();
  var opticClamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  function sampleOpticalTransition(record, now, reduced = false) {
    const duration = record.duration || 0;
    const position = reduced || !duration ? 1 : opticClamp((now - record.start) / duration);
    const eased = 1 - (1 - position) ** 3;
    const result = { ...record.to };
    for (const key of ["fill", "complete", "selected", "hover"]) {
      const end = record.to[key] || 0, start2 = record.from[key] || 0;
      const t = key === "complete" && end > start2 ? opticClamp((position - 0.12) / 0.88) : eased;
      result[key] = t === 1 ? end : start2 + (end - start2) * t;
    }
    if (typeof record.to.opacity === "number") result.opacity = position === 1 ? record.to.opacity : (record.from.opacity ?? record.to.opacity) + (record.to.opacity - (record.from.opacity ?? record.to.opacity)) * eased;
    const elapsed = now - record.flowStart;
    result.flow = !reduced && record.flowStart !== null && elapsed >= 0 && elapsed < tokens.optics.flowDuration ? elapsed / tokens.optics.flowDuration : -1;
    return result;
  }
  function readOpticalState(element, now = performance.now(), reduced = false) {
    const record = opticalRecords.get(element);
    return record ? sampleOpticalTransition(record, now, reduced && !record.to.forceMotion) : null;
  }

  // src/appearance/lens/internal/context-budget.js
  var ContextBudget = class {
    constructor(limit = 6) {
      this.limit = limit;
      this.clients = /* @__PURE__ */ new Set();
    }
    add(client) {
      const entry = { ...client, active: false };
      this.clients.add(entry);
      entry.destroy = () => {
        this.clients.delete(entry);
        if (entry.active) {
          entry.active = false;
          entry.suspend();
        }
      };
      return entry;
    }
    update() {
      const ranked = [...this.clients].map((entry) => ({ entry, rank: entry.priority() })).filter(({ rank }) => Number.isFinite(rank)).sort((a, b) => b.rank - a.rank);
      const wanted = new Set(ranked.slice(0, this.limit).map(({ entry }) => entry));
      for (const entry of this.clients) if (entry.active && !wanted.has(entry)) {
        entry.active = false;
        entry.suspend();
      }
      for (const entry of wanted) if (!entry.active) {
        entry.active = true;
        entry.activate();
      }
    }
  };
  function viewportPriority(host) {
    const doc = host.ownerDocument, win = doc.defaultView;
    if (!host.isConnected || doc.hidden || !host.getClientRects().length) return -Infinity;
    const style = win.getComputedStyle(host);
    if (style.visibility === "hidden") return -Infinity;
    let rect = host.getBoundingClientRect(), left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(win.innerWidth, rect.right), bottom = Math.min(win.innerHeight, rect.bottom);
    if (right <= left || bottom <= top) return -Infinity;
    for (let current = win; current.frameElement; current = current.parent) {
      const frame = current.frameElement, r = frame.getBoundingClientRect();
      if (!frame.getClientRects().length || current.parent.document.hidden || r.bottom <= 0 || r.top >= current.parent.innerHeight || r.right <= 0 || r.left >= current.parent.innerWidth) return -Infinity;
    }
    return (right - left) * (bottom - top) / Math.max(1, rect.width * rect.height) - Math.abs((top + bottom) / 2 - win.innerHeight / 2) / Math.max(1, win.innerHeight) * 0.01;
  }
  function observeGPU(host, activate, suspend) {
    const win = host.ownerDocument.defaultView;
    let owner = win;
    try {
      while (owner.parent !== owner && owner.parent.document) owner = owner.parent;
    } catch {
    }
    const key = Symbol.for("lens.viewport-gpu-budget.v1");
    if (!owner[key]) {
      const budget = new ContextBudget(6), documents = /* @__PURE__ */ new Map();
      let frame = 0;
      const schedule = () => {
        if (!frame) frame = owner.requestAnimationFrame(() => {
          frame = 0;
          budget.update();
        });
      };
      owner[key] = { budget, documents, schedule };
    }
    const shared = owner[key], doc = host.ownerDocument;
    if (!shared.documents.has(doc)) {
      const abort = new win.AbortController(), signal = abort.signal;
      doc.addEventListener("scroll", shared.schedule, { capture: true, passive: true, signal });
      doc.addEventListener("visibilitychange", shared.schedule, { signal });
      win.addEventListener("resize", shared.schedule, { passive: true, signal });
      shared.documents.set(doc, { count: 0, abort });
    }
    const connection = shared.documents.get(doc);
    connection.count++;
    const lease = shared.budget.add({ priority: () => viewportPriority(host), activate, suspend });
    const resize = new win.ResizeObserver(shared.schedule);
    resize.observe(host);
    const intersection = new win.IntersectionObserver(shared.schedule);
    intersection.observe(host);
    let destroyed = false;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      resize.disconnect();
      intersection.disconnect();
      lease.destroy();
      win.removeEventListener("pagehide", pagehide);
      if (!--connection.count) {
        connection.abort.abort();
        shared.documents.delete(doc);
      }
      shared.schedule();
    };
    const pagehide = (event) => {
      if (!event.persisted) destroy();
    };
    win.addEventListener("pagehide", pagehide);
    shared.schedule();
    return { get active() {
      return lease.active;
    }, destroy, update: shared.schedule };
  }

  // src/appearance/lens/internal/renderer.js
  var VERTEX = `#version 300 es
in vec2 aPosition;
uniform vec2 uResolution;
uniform vec4 uQuad;
out vec2 vPixel;
void main(){
  vPixel = uQuad.xy + (aPosition * .5 + .5) * uQuad.zw;
  gl_Position = vec4(vPixel / uResolution * 2. - 1., 0., 1.);
}`;
  var BACKGROUND = `#version 300 es
precision highp float;
in vec2 vPixel;
out vec4 outColor;
uniform sampler2D uArtwork;
uniform vec2 uResolution;
uniform float uTime;
uniform float uAnimate;
uniform float uBrightness;
uniform float uGrid;
void main(){
  vec2 uv = vPixel / uResolution;
  float movement = uAnimate * (1. - uGrid);
  uv.x += sin(uv.y * 5.8 + uTime * .21) * .012 * movement;
  uv.y += sin(uv.x * 5. + uTime * .16) * .010 * movement;
  vec3 c = texture(uArtwork, clamp(uv, .001, .999)).rgb;
  c *= uBrightness;
  outColor = vec4(c, 1.);
}`;
  var COPY = `#version 300 es
precision highp float;
in vec2 vPixel;
out vec4 outColor;
uniform sampler2D uScene;
uniform vec2 uResolution;
void main(){ outColor = texture(uScene, vPixel / uResolution); }
`;
  var LENS = `#version 300 es
precision highp float;
in vec2 vPixel;
out vec4 outColor;
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform vec4 uBox;
uniform vec2 uLocalSize;
uniform mat2 uInverse;
uniform vec2 uBend;
uniform float uPressure;
uniform float uEnergy;
uniform vec2 uPointer;
uniform float uRadius;
uniform float uScale;
uniform float uRefraction;
uniform float uBlur;
uniform float uDispersion;
uniform float uTint;
uniform float uDark;
uniform float uCompare;
uniform float uHover;
uniform vec4 uAccent;
uniform float uOpacity;
uniform float uOpticKind;
uniform vec4 uOptic;
uniform vec3 uEmission;
uniform float uFlow;
uniform float uZoom;
uniform float uWaveTime;

float roundedBox(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return min(max(q.x,q.y),0.) + length(max(q,0.)) - r;
}
float surfaceDistance(vec2 world){
  vec2 p=uInverse*world;
  vec2 halfSize=uLocalSize*.5;
  vec2 q=clamp(p/max(halfSize,vec2(1.)),vec2(-1.3),vec2(1.3));
  // A dragged surface bows between its corners, then settles with the spring.
  // This same shape drives silhouette, refraction normals and specular light.
  p -= uBend * vec2(1.-q.y*q.y,1.-q.x*q.x)*.7;
  float r=min(uRadius*(1.+uPressure*.15),min(halfSize.x,halfSize.y));
  return roundedBox(p,halfSize,r);
}
vec3 sampleScene(vec2 px){
  return texture(uScene,clamp(px/uResolution,vec2(.001),vec2(.999))).rgb;
}
vec3 blurred(vec2 px, float blur){
  vec3 c = sampleScene(px) * .24;
  c += sampleScene(px + vec2(blur,0.)) * .12;
  c += sampleScene(px - vec2(blur,0.)) * .12;
  c += sampleScene(px + vec2(0.,blur)) * .12;
  c += sampleScene(px - vec2(0.,blur)) * .12;
  c += sampleScene(px + vec2(blur,blur)*.707) * .07;
  c += sampleScene(px - vec2(blur,blur)*.707) * .07;
  c += sampleScene(px + vec2(blur,-blur)*.707) * .07;
  c += sampleScene(px + vec2(-blur,blur)*.707) * .07;
  return c;
}
void main(){
  vec2 center = uBox.xy + uBox.zw * .5;
  vec2 p = vPixel - center;
  vec2 b = uLocalSize * .5;
  vec2 local = uInverse*p;
  vec2 opticalUV = clamp(local/max(uLocalSize,vec2(1.))+.5,0.,1.);
  float d = surfaceDistance(p);
  vec3 base = sampleScene(vPixel);
  bool progressGlass = uOpticKind > .5 && uOpticKind < 1.5;
  bool wellGlass = uOpticKind > 1.5 && uOpticKind < 2.5;
  bool fieldGlass = uOpticKind > 2.5 && uOpticKind < 3.5;
  bool magnifier = uOpticKind > 3.5;
  float filled = progressGlass ? (1.-smoothstep(uOptic.x-.007,uOptic.x+.007,opticalUV.x))*step(.0001,uOptic.x) : 0.;
  vec3 sourceColor = mix(vec3(.42,.86,1.),uEmission,uOptic.y);
  vec2 emitter = vec2(-b.x+uLocalSize.x*uOptic.x,0.);
  float sourceGlow = exp(-length((local-emitter)/vec2(23.,15.)/uScale)*1.6)*step(.0001,uOptic.x);
  float halo = exp(-max(d,0.)/(7.*uScale));
  if(progressGlass) base += sourceColor*(sourceGlow*.23+halo*uOptic.y*.075)*uOpacity;
  if(wellGlass) base += vec3(.37,.8,1.)*halo*uOptic.w*.14*uOpacity;
  if(uOptic.z>0.) base += uEmission*halo*uOptic.z*.055*uOpacity;
  float shadowD = surfaceDistance(p+vec2(0.,(5.+uPressure*3.)*uScale));
  float shadow = exp(-max(shadowD,0.)/((7.+uPressure*2.)*uScale))*.078;
  base *= 1. - shadow * uOpacity * smoothstep(-.5*uScale,1.5*uScale,d);
  if(d > 1.5*uScale){outColor=vec4(base,1.);return;}

  float e = .7 * uScale;
  vec2 n2 = normalize(vec2(
    surfaceDistance(p+vec2(e,0.))-surfaceDistance(p-vec2(e,0.)),
    surfaceDistance(p+vec2(0.,e))-surfaceDistance(p-vec2(0.,e))
  )+vec2(.00001));
  float bevel = min(min(b.x,b.y)*.48,19.*uScale);
  float edge = clamp(1.+d/bevel,0.,1.);
  float slope = pow(edge,1.65)*.94;
  vec2 faceNormal=clamp(p/max(b,vec2(1.)),vec2(-1.),vec2(1.))*.045*(1.-edge);
  vec2 normalXY=n2*slope+faceNormal;
  if(wellGlass) normalXY *= mix(-1.,1.,uOptic.z);
  vec3 normal = vec3(normalXY,sqrt(max(1.-dot(normalXY,normalXY),.001)));
  // Snell's law: air (1.0) -> a glass-like medium (1.45).
  vec3 ray = refract(vec3(0.,0.,-1.),normal,1./1.45);
  float thickness = (18.+uRefraction*57.)*uScale*(1.+uPressure*.13+uEnergy*.12);
  vec2 offset = ray.xy/max(-ray.z,.05)*thickness*uRefraction;
  offset -= p * .016 * uRefraction;
  offset *= 1.+filled*.85;
  if(progressGlass) offset.y += sin(opticalUV.x*24.-uWaveTime*2.2)*filled*2.4*uScale;
  offset *= 1.-uCompare;
  vec2 at = vPixel + offset;
  if(magnifier) at = center+p/max(uZoom,1.)+offset*.18;
  float blur = uBlur * 10. * uScale + uCompare * 5. * uScale;
  blur *= magnifier ? .12 : 1.-filled*.65;
  vec3 c = blurred(at,blur);
  vec2 split = n2*pow(edge,2.8)*uDispersion*2.6*uScale*(1.-uCompare);
  c.r += (sampleScene(at+split).r-sampleScene(at).r)*.8;
  c.b += (sampleScene(at-split).b-sampleScene(at).b)*.8;
  // Very slight saturation lift plus an adaptive, readable material tint.
  float luma = dot(c,vec3(.2126,.7152,.0722));
  c = mix(vec3(luma),c,1.035);
  vec3 tint = mix(vec3(.97,.985,1.),vec3(.16,.24,.34),uDark);
  c = mix(c,tint,uTint+uBlur*.12+uCompare*.11+uDark*.10);
  c = mix(c,uAccent.rgb,uAccent.a);
  if(fieldGlass){
    vec2 q=clamp((local+b-vec2(40.*uScale))/max(uLocalSize-vec2(80.*uScale),vec2(1.)),0.,1.);
    vec3 low=mix(vec3(.50,.66,.82),vec3(.89,.69,.47),q.x);
    vec3 high=mix(vec3(.60,.55,.69),vec3(.83,.58,.59),q.x);
    c=mix(low,high,q.y);
    vec2 lines=abs(fract(q*8.+.5)-.5)/max(fwidth(q*8.),vec2(.001));
    float grid=1.-smoothstep(.2,.9,min(lines.x,lines.y));
    float axes=1.-smoothstep(.002,.006,min(abs(q.x-.5),abs(q.y-.5)));
    c=mix(c,vec3(.97),grid*.18+axes*.26);
  }

  vec2 light = normalize(uPointer-center+vec2(-80.,150.)*uScale);
  float directional = pow(max(dot(n2,light),0.),7.);
  float opposite = pow(max(dot(n2,-light),0.),7.)*.52;
  float fresnel = .04+.96*pow(1.-normal.z,5.);
  float outline = 1.-smoothstep(.12*uScale,1.1*uScale,abs(d+.65*uScale));
  float edgeLight = (directional+opposite)*pow(edge,4.);
  float spec = edgeLight*.065 + outline*(.018+directional*.35+opposite*.15);
  spec += fresnel*.035;
  spec *= 1.-uCompare;
  vec3 environment=sampleScene(vPixel+n2*34.*uScale);
  c=mix(c,environment,fresnel*.12*(1.-uCompare));
  c += mix(vec3(1.),environment,.18)*spec;
  float caustic=exp(-pow((d+3.*uScale)/(1.65*uScale),2.));
  c += caustic*opposite*.038*(1.-uCompare);
  // A broad, quiet reflection follows the pointer inside the material.
  float glint = exp(-length((vPixel-uPointer)/vec2(180.,150.)/uScale)*2.);
  c += glint*.024*(.4+uHover)*(1.-uCompare);
  vec2 face=p/max(b,vec2(1.));
  float broadReflection=exp(-pow((face.x*.55+face.y*.8-light.x*.4)*1.6,2.));
  vec3 ambient=sampleScene(center+vec2(-b.x*.6,b.y*.55));
  c=mix(c,clamp(ambient+vec3(.15),0.,1.),broadReflection*(.045+uPressure*.035)*(1.-uCompare));
  c -= pow(edge,8.)*max(dot(n2,vec2(.45,-.89)),0.)*.085*(1.-uCompare);
  if(wellGlass){
    // Reverse the bevel and occlusion: the receiver sits below the glass plane.
    c -= pow(edge,2.)*max(dot(n2,normalize(vec2(-.4,.9))),0.)*.24*(1.-uOptic.z);
    c += pow(edge,4.)*max(dot(n2,normalize(vec2(.4,-.9))),0.)*.19*(1.-uOptic.z);
    c += vec3(.3,.76,1.)*uOptic.w*(pow(edge,3.)*.35+.04);
    c=mix(c,c*vec3(.89,1.04,.95)+uEmission*.045,uOptic.z*.55);
  }
  float phase=fract(atan(local.y/max(b.y,1.),local.x/max(b.x,1.))/6.2831853+.5);
  float travel=fract(phase-uFlow*1.15+1.);
  float flow=uFlow>=0. ? exp(-pow(travel/.105,2.))*sin(3.14159265*clamp(uFlow,0.,1.)) : 0.;
  float lightEdge=exp(-pow((d+1.4*uScale)/(1.25*uScale),2.));
  float innerEdge=exp(-pow((d+4.*uScale)/(3.*uScale),2.));
  if(progressGlass){
    float fiberY=local.y/uScale-sin(opticalUV.x*16.-uWaveTime*2.8)*1.5-sin(opticalUV.x*31.-uWaveTime*4.1)*.35;
    float fiber=exp(-pow(fiberY/1.0,2.))*.24+exp(-pow((fiberY-5.)/.65,2.))*.11;
    float spark=exp(-pow((fract(opticalUV.x-uWaveTime*.12)-.08)/.065,2.));
    c += sourceColor*(filled*(fiber*(1.+spark*.42)+innerEdge*.10)+sourceGlow*.42+lightEdge*uOptic.y*.26);
    c += mix(vec3(.8,.98,1.),uEmission,uOptic.y)*(lightEdge*.75+innerEdge*.15)*flow;
  }
  c += uEmission*uOptic.z*(lightEdge*.28+innerEdge*.045);
  if(!progressGlass) c += mix(uEmission,vec3(1.),.45)*uOptic.z*(lightEdge*.8+innerEdge*.18)*flow;
  float aa=max(fwidth(d)*.7,.5*uScale);
  float mask = 1.-smoothstep(-aa,aa,d);
  outColor=vec4(mix(base,c,mask*uOpacity),1.);
}`;
  function shader(gl, type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(message);
    }
    return s;
  }
  function program(gl, fragment) {
    const p = gl.createProgram();
    const vs = shader(gl, gl.VERTEX_SHADER, VERTEX), fs = shader(gl, gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const uniforms = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
      const u = gl.getActiveUniform(p, i);
      uniforms[u.name] = gl.getUniformLocation(p, u.name);
    }
    return { p, uniforms };
  }
  var GlassRenderer = class {
    constructor(canvas, stage, options = {}) {
      this.canvas = canvas;
      this.stage = stage;
      this.artwork = typeof options.artwork === "function" ? options.artwork : null;
      this.settings = { ...tokens.materials.thick, brightness: 0.95, motion: true, opaque: false, compare: false, scene: "aurora", ...options };
      this.pointer = { x: 0, y: 0 };
      this.smoothPointer = { x: 0, y: 0 };
      this.time = 0;
      this.lastTime = 0;
      this.frame = 0;
      this.dirty = true;
      this.rectDirty = true;
      this.geometry = [];
      this.visible = true;
      this.destroyed = false;
      this.animatingUntil = 0;
      this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.gl = null;
      this.suspended = true;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.onState = options.onState;
      canvas.hidden = true;
      canvas.dataset.gpuState = "idle";
      stage.classList.add("fallback");
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
        this.invalidate(150);
      });
      this.resizeObserver.observe(stage);
      this.mutationObserver = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "childList") {
            if ([...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1)) {
              this.invalidate();
              break;
            }
          } else if (record.target.matches("[data-glass]") || record.target.querySelector("[data-glass]")) {
            this.invalidate(record.attributeName === "data-controls-hidden" ? 220 : 0);
            break;
          }
        }
      });
      this.mutationObserver.observe(stage, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-controls-hidden", "aria-selected", "aria-pressed", "aria-checked"] });
      this.intersectionObserver = new IntersectionObserver((entries) => {
        this.visible = entries[0].isIntersecting;
        if (this.visible) this.invalidate();
      });
      this.intersectionObserver.observe(stage);
      this.abort = new AbortController();
      const signal = this.abort.signal;
      stage.addEventListener("pointermove", (e) => {
        const r = stage.getBoundingClientRect();
        this.pointer.x = (e.clientX - r.left) * this.dpr;
        this.pointer.y = (r.height - e.clientY + r.top) * this.dpr;
        this.invalidate(this.reducedMotion ? 0 : 220, false);
      }, { signal, passive: true });
      stage.addEventListener("pointerdown", () => this.invalidate(650), { signal, passive: true });
      stage.addEventListener("pointerup", () => this.invalidate(650), { signal, passive: true });
      stage.addEventListener("lg:optics", (event) => this.invalidate(event.detail.duration, false), { signal });
      stage.addEventListener("scroll", () => this.invalidate(), { capture: true, signal, passive: true });
      window.addEventListener("resize", () => this.invalidate(300), { signal, passive: true });
      document.addEventListener("visibilitychange", () => {
        this.lastTime = 0;
        if (!document.hidden) this.invalidate();
      }, { signal });
      canvas.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        this.lossObserved = true;
        this.lost = true;
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        canvas.hidden = true;
        stage.classList.remove("webgl-ready");
        stage.classList.add("fallback");
        if (!this.suspended) options.onState?.("lost");
        if (this.gpuLease?.active) this.resumeGPU();
      }, { signal });
      canvas.addEventListener("webglcontextrestored", () => {
        this.lossObserved = false;
        if (this.destroyed || !this.gpuLease?.active) {
          this.contextExtension?.loseContext();
          return;
        }
        this.startGPU();
      }, { signal });
      this.gpuLease = observeGPU(stage, () => this.resumeGPU(), () => this.suspendGPU());
    }
    resumeGPU() {
      if (this.destroyed) return;
      if (this.gl?.isContextLost()) {
        if (this.lossObserved) {
          this.canvas.dataset.gpuState = "restoring";
          this.contextExtension?.restoreContext();
        }
        return;
      }
      this.startGPU();
    }
    startGPU() {
      try {
        this.gl || (this.gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: "low-power" }));
        if (!this.gl) throw new Error("WebGL2 unavailable");
        this.contextExtension = this.gl.getExtension("WEBGL_lose_context");
        this.suspended = false;
        this.lost = false;
        this.initGL();
        this.resize();
        if (!this.hasPointer) {
          this.pointer = { x: this.width * 0.25, y: this.height * 0.85 };
          this.smoothPointer = { ...this.pointer };
          this.hasPointer = true;
        }
        this.canvas.hidden = false;
        this.canvas.dataset.gpuState = "active";
        this.stage.classList.add("webgl-ready");
        this.stage.classList.remove("fallback");
        this.onState?.("ready");
        this.lastTime = 0;
        this.invalidate(150);
      } catch (error) {
        this.suspendGPU();
        this.onState?.("lost");
        console.warn("Glass initialization failed", error);
      }
    }
    suspendGPU() {
      this.suspended = true;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.canvas.hidden = true;
      this.canvas.dataset.gpuState = "suspended";
      this.stage.classList.remove("webgl-ready");
      this.stage.classList.add("fallback");
      if (this.gl && !this.gl.isContextLost()) this.contextExtension?.loseContext();
    }
    initGL() {
      const gl = this.gl;
      this.programs = { background: program(gl, BACKGROUND), copy: program(gl, COPY), lens: program(gl, LENS) };
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      this.textures = { art: this.makeTexture(), scene: this.makeTexture(), composite: this.makeTexture() };
      this.targets = ["scene", "composite"].map((name) => {
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[name], 0);
        return { framebuffer, texture: this.textures[name] };
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      this.width = 0;
      this.height = 0;
    }
    makeTexture() {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    resize() {
      if (this.destroyed || this.suspended || this.lost || !this.gl || this.gl.isContextLost?.()) return;
      const rect = this.stage.getBoundingClientRect();
      this.dpr = Math.min(devicePixelRatio || 1, 1.75);
      const width = Math.max(1, Math.round(rect.width * this.dpr)), height = Math.max(1, Math.round(rect.height * this.dpr));
      if (width === this.width && height === this.height) return;
      this.width = width;
      this.height = height;
      this.canvas.width = width;
      this.canvas.height = height;
      const gl = this.gl;
      for (const target of this.targets) {
        gl.bindTexture(gl.TEXTURE_2D, target.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Incomplete scene framebuffer");
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.setScene(this.settings.scene);
      this.rectDirty = true;
    }
    setScene(name) {
      this.settings.scene = name;
      if (this.suspended || !this.gl || this.gl.isContextLost?.()) return;
      const art = document.createElement("canvas");
      art.width = this.width;
      art.height = this.height;
      const ctx = art.getContext("2d"), w = art.width, h = art.height;
      if (this.artwork) {
        this.artwork(ctx, { width: w, height: h, dpr: this.dpr, scene: name });
      } else {
        const palettes = { aurora: ["#d3e8e3", "#badde8", "#9db7dc", "#929ee0", "#d3b4d2", "#eccbc1"], sunset: ["#f2dfbd", "#f5cdaf", "#e7a59c", "#c387a2", "#9f89b2", "#dcb9c3"], ocean: ["#326975", "#286d85", "#225879", "#293e68", "#4a5486", "#7184a3"] };
        if (name === "grid") {
          ctx.fillStyle = "#e8ebef";
          ctx.fillRect(0, 0, w, h);
          ctx.lineWidth = this.dpr;
          const step = 34 * this.dpr;
          for (let x = 0; x < w; x += step) {
            ctx.strokeStyle = Math.round(x / step) % 4 === 0 ? "#a1acbb" : "#c4cbd5";
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
          }
          for (let y = 0; y < h; y += step) {
            ctx.strokeStyle = Math.round(y / step) % 4 === 0 ? "#a1acbb" : "#c4cbd5";
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }
        } else {
          const p = palettes[name] || palettes.aurora;
          const gradient = ctx.createLinearGradient(0, 0, w, h);
          gradient.addColorStop(0, p[0]);
          gradient.addColorStop(0.5, p[1]);
          gradient.addColorStop(1, p[5]);
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, w, h);
          const ribbon = (offset, color1, color2) => {
            const contour = new Path2D();
            contour.moveTo(-w * 0.1, h * (0.98 + offset));
            contour.bezierCurveTo(w * 0.13, h * (0.39 + offset), w * 0.48, h * (0.86 + offset), w * 1.1, h * (-0.32 + offset));
            const shape = new Path2D(contour);
            shape.lineTo(w * 1.15, h * 1.4);
            shape.lineTo(-w * 0.1, h * 1.4);
            shape.closePath();
            const g = ctx.createLinearGradient(w * 0.05, h * 0.1, w * 0.87, h * 0.92);
            g.addColorStop(0, color1);
            g.addColorStop(0.48, color2);
            g.addColorStop(1, p[5]);
            ctx.save();
            ctx.shadowColor = name === "ocean" ? "#0b23484a" : "#38486830";
            ctx.shadowBlur = 27 * this.dpr;
            ctx.shadowOffsetY = -7 * this.dpr;
            ctx.fillStyle = g;
            ctx.fill(shape);
            ctx.restore();
            ctx.save();
            ctx.clip(shape);
            ctx.filter = `blur(${15 * this.dpr}px)`;
            ctx.strokeStyle = name === "ocean" ? "#bce9ff24" : "#ffffff45";
            ctx.lineWidth = 37 * this.dpr;
            ctx.stroke(contour);
            ctx.filter = "none";
            ctx.strokeStyle = "#ffffff25";
            ctx.lineWidth = 1.2 * this.dpr;
            ctx.stroke(contour);
            const roll = ctx.createLinearGradient(0, h * (0.25 + offset), w * 0.7, h * (1.08 + offset));
            roll.addColorStop(0, "#ffffff00");
            roll.addColorStop(0.45, "#ffffff00");
            roll.addColorStop(0.72, "#324e7e13");
            roll.addColorStop(1, "#ffffff1c");
            ctx.fillStyle = roll;
            ctx.fill(shape);
            ctx.restore();
          };
          ribbon(-0.31, p[1], p[2]);
          ribbon(-0.1, p[2], p[3]);
          ribbon(0.18, p[3], p[4]);
          ribbon(0.44, p[4], p[5]);
          const glow = ctx.createRadialGradient(w * 0.12, h * 0.08, 0, w * 0.12, h * 0.08, w * 0.85);
          glow.addColorStop(0, "#ffffff55");
          glow.addColorStop(1, "#ffffff00");
          ctx.fillStyle = glow;
          ctx.fillRect(0, 0, w, h);
        }
        const size = Math.min(w * 0.265, h * 0.3);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `300 ${size}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
        ctx.fillStyle = name === "grid" ? "#596578" : "#ffffff75";
        ctx.fillText("hello.", w * 0.47, h * 0.49);
      }
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.textures.art);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, art);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this.invalidate();
    }
    set(next) {
      const previousScene = this.settings.scene;
      Object.assign(this.settings, next);
      if (next.scene && (next.scene !== previousScene || this.artwork)) this.setScene(next.scene);
      this.invalidate(400);
    }
    setMotionSource(source) {
      this.motionSource = source;
      this.invalidate();
    }
    invalidate(duration = 0, geometry = true) {
      if (this.destroyed || this.suspended || this.lost) return;
      this.dirty = true;
      if (geometry) this.rectDirty = true;
      this.animatingUntil = Math.max(this.animatingUntil, performance.now() + duration);
      if (!this.frame) this.frame = requestAnimationFrame((t) => this.render(t));
    }
    readGeometry() {
      const stage = this.stage.getBoundingClientRect(), s = this.dpr;
      const matrices = /* @__PURE__ */ new Map();
      const transformFor = (el) => {
        if (!el || el === this.stage) return new DOMMatrix();
        if (matrices.has(el)) return matrices.get(el);
        const transform = getComputedStyle(el).transform;
        const own = transform === "none" ? new DOMMatrix() : new DOMMatrix(transform);
        own.e = 0;
        own.f = 0;
        const total = transformFor(el.parentElement).multiply(own);
        matrices.set(el, total);
        return total;
      };
      const rank = { "xy-field": -1, "optical-well": 0, tab: 0, note: 1, panel: 2, dock: 3, small: 4, "switch-track": 4, thumb: 5, "slider-thumb": 5, selected: 6, free: 7, "optical-lens": 7, menu: 8 };
      const depth = (el) => {
        let value = 0;
        for (let parent = el.parentElement; parent && parent !== this.stage; parent = parent.parentElement) if (parent.dataset.glass) value++;
        return value;
      };
      const clipFor = (el) => {
        let left = stage.left, top = stage.top, right = stage.right, bottom = stage.bottom;
        for (let parent = el.parentElement; parent && parent !== this.stage; parent = parent.parentElement) {
          const cs = getComputedStyle(parent), explicit = parent.dataset.lgClip === "true";
          const clipX = explicit || /^(auto|scroll|hidden|clip)$/.test(cs.overflowX);
          const clipY = explicit || /^(auto|scroll|hidden|clip)$/.test(cs.overflowY);
          if (!clipX && !clipY) continue;
          const r = parent.getBoundingClientRect(), clientLeft = r.left + parent.clientLeft, clientTop = r.top + parent.clientTop;
          if (clipX) {
            left = Math.max(left, clientLeft);
            right = Math.min(right, clientLeft + parent.clientWidth);
          }
          if (clipY) {
            top = Math.max(top, clientTop);
            bottom = Math.min(bottom, clientTop + parent.clientHeight);
          }
        }
        return { left: (left - stage.left) * s, right: (right - stage.left) * s, bottom: (stage.bottom - bottom) * s, top: (stage.bottom - top) * s };
      };
      this.geometry = [...this.stage.querySelectorAll("[data-glass]")].filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden").sort((a, b) => depth(a) - depth(b) || (rank[a.dataset.glass] ?? 0) - (rank[b.dataset.glass] ?? 0)).map((el) => {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el), kind = el.dataset.glass;
        const localW = el.offsetWidth, localH = el.offsetHeight;
        const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 24, localW / 2, localH / 2) * s;
        const m = transformFor(el), det = m.a * m.d - m.b * m.c;
        const inverse = Math.abs(det) > 1e-3 ? [m.d / det, m.b / det, m.c / det, m.a / det] : [1, 0, 0, 1];
        let opacity = 1;
        for (let parent = el; parent && parent !== this.stage; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
        const selected = Number(cs.getPropertyValue("--glass-selection")) || 0;
        return { el, kind, opacity, selected, x: (r.left - stage.left) * s, y: (stage.bottom - r.bottom) * s, w: r.width * s, h: r.height * s, r: radius, localW: localW * s, localH: localH * s, inverse, clip: clipFor(el) };
      });
      this.rectDirty = false;
    }
    use(p, quad = [0, 0, this.width, this.height]) {
      const gl = this.gl;
      gl.useProgram(p.p);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      const a = gl.getAttribLocation(p.p, "aPosition");
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(p.uniforms.uResolution, this.width, this.height);
      gl.uniform4fv(p.uniforms.uQuad, quad);
    }
    render(now) {
      this.frame = 0;
      if (this.destroyed || this.transitionPaused || this.suspended || this.lost || !this.gl || document.hidden || !this.visible) return;
      const dt = this.lastTime ? Math.min((now - this.lastTime) / 1e3, 0.05) : 0.016;
      this.lastTime = now;
      if (this.settings.motion && !this.reducedMotion) this.time += dt;
      const lerp = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 13);
      this.smoothPointer.x += (this.pointer.x - this.smoothPointer.x) * lerp;
      this.smoothPointer.y += (this.pointer.y - this.smoothPointer.y) * lerp;
      if (this.rectDirty || now < this.animatingUntil) this.readGeometry();
      const gl = this.gl, p = this.programs;
      let opticalMoving = false;
      gl.viewport(0, 0, this.width, this.height);
      gl.activeTexture(gl.TEXTURE0);
      let source = this.targets[0], destination = this.targets[1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, source.framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, this.textures.art);
      this.use(p.background);
      gl.uniform1i(p.background.uniforms.uArtwork, 0);
      gl.uniform1f(p.background.uniforms.uTime, this.time);
      gl.uniform1f(p.background.uniforms.uAnimate, this.reducedMotion ? 0 : 1);
      gl.uniform1f(p.background.uniforms.uGrid, this.settings.scene === "grid" ? 1 : 0);
      gl.uniform1f(p.background.uniforms.uBrightness, this.settings.brightness);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!this.settings.opaque) {
        for (const g of this.geometry) {
          const pad = 36 * this.dpr;
          const x = Math.max(0, g.clip.left, Math.floor(g.x - pad)), y = Math.max(0, g.clip.bottom, Math.floor(g.y - pad));
          const right = Math.min(this.width, g.clip.right, Math.ceil(g.x + g.w + pad)), top = Math.min(this.height, g.clip.top, Math.ceil(g.y + g.h + pad));
          const width = right - x, height = top - y;
          if (width <= 0 || height <= 0) continue;
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination.framebuffer);
          gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
          gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer);
          gl.bindTexture(gl.TEXTURE_2D, source.texture);
          this.use(p.lens, [x, y, width, height]);
          const u = p.lens.uniforms;
          gl.uniform1i(u.uScene, 0);
          gl.uniform4f(u.uBox, g.x, g.y, g.w, g.h);
          gl.uniform1f(u.uRadius, g.r);
          gl.uniform1f(u.uScale, this.dpr);
          gl.uniform2f(u.uLocalSize, g.localW, g.localH);
          gl.uniformMatrix2fv(u.uInverse, false, g.inverse);
          const effect = readOpticalState(g.el, now, this.reducedMotion);
          const optical = effect?.deformation || this.motionSource?.optics(g.el) || { bend: [0, 0], pressure: 0, energy: 0 };
          gl.uniform2f(u.uBend, optical.bend[0] * this.dpr, -optical.bend[1] * this.dpr);
          gl.uniform1f(u.uPressure, optical.pressure);
          gl.uniform1f(u.uEnergy, optical.energy);
          gl.uniform2f(u.uPointer, this.smoothPointer.x, this.smoothPointer.y);
          const rail = g.kind === "switch-track", thumb = g.kind === "thumb";
          gl.uniform1f(u.uRefraction, this.settings.refraction * (rail ? 0.12 : thumb ? 0.45 : 1));
          gl.uniform1f(u.uBlur, this.settings.blur);
          gl.uniform1f(u.uDispersion, this.settings.dispersion * (rail || thumb ? 0.2 : 1));
          const tint = { panel: 0.14, dock: 0.095, small: 0.12, thumb: 0.83, "switch-track": 0.06, "slider-thumb": 0.18, selected: 0.19, tab: 0.18, note: 0.09, free: 0.012, menu: 0.6, "optical-lens": 0.012, "optical-well": 0.055 }[g.kind] ?? 0.13;
          gl.uniform1f(u.uTint, tint);
          gl.uniform1f(u.uDark, this.settings.scene === "ocean" && !thumb ? 1 : 0);
          const progress = rail ? this.motionSource?.toggleProgress(g.el.parentElement) || 0 : 0;
          gl.uniform4f(u.uAccent, rail ? 0.38 - progress * 0.22 : 0.25, rail ? 0.45 + progress * 0.17 : 0.51, rail ? 0.54 - progress * 0.17 : 0.87, rail ? 0.48 + progress * 0.34 : g.selected * 0.17);
          gl.uniform1f(u.uOpacity, g.opacity * (effect?.opacity ?? 1));
          const waving = effect?.kind === 1 && effect.wave && effect.fill > 0 && (!this.reducedMotion || effect.forceMotion);
          opticalMoving || (opticalMoving = Boolean(waving));
          gl.uniform1f(u.uOpticKind, effect?.kind || 0);
          gl.uniform4f(u.uOptic, effect?.fill || 0, effect?.complete || 0, effect?.selected || 0, effect?.hover || 0);
          gl.uniform3fv(u.uEmission, effect?.color || [0.32, 0.73, 0.51]);
          gl.uniform1f(u.uFlow, effect?.flow ?? -1);
          gl.uniform1f(u.uZoom, effect?.zoom || 1);
          gl.uniform1f(u.uWaveTime, waving ? now * 1e-3 : 0);
          gl.uniform1f(u.uCompare, this.settings.compare ? 1 : 0);
          gl.uniform1f(u.uHover, g.el.matches(":hover") ? 1 : 0);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          [source, destination] = [destination, source];
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, source.texture);
      this.use(p.copy);
      gl.uniform1i(p.copy.uniforms.uScene, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this.dirty = false;
      this.settings.afterRender?.(this.canvas);
      const moving = this.settings.motion && !this.reducedMotion && this.settings.scene !== "grid";
      if (moving || opticalMoving || now < this.animatingUntil) this.frame = requestAnimationFrame((t) => this.render(t));
    }
    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.frame);
      this.abort.abort();
      this.resizeObserver.disconnect();
      this.mutationObserver.disconnect();
      this.intersectionObserver.disconnect();
      this.gpuLease?.destroy();
      const gl = this.gl;
      if (!gl) return;
      Object.values(this.programs || {}).forEach((p) => gl.deleteProgram(p.p));
      Object.values(this.textures || {}).forEach((t) => gl.deleteTexture(t));
      (this.targets || []).forEach((t) => gl.deleteFramebuffer(t.framebuffer));
      gl.deleteBuffer(this.buffer);
      gl.deleteVertexArray(this.vao);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  };

  // src/appearance/lens/internal/jelly.js
  var JellyController = class {
    constructor(stage, renderer, { intensity = 0.7 } = {}) {
      this.stage = stage;
      this.renderer = renderer;
      this.intensity = intensity;
      this.bodies = /* @__PURE__ */ new Map();
      this.frame = 0;
      this.last = 0;
      this.gesture = null;
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.abort = new AbortController();
      this.signal = this.abort.signal;
      this.blockClick = null;
      window.addEventListener("pointermove", (e) => this.move(e), { signal: this.signal, passive: false });
      window.addEventListener("pointerup", (e) => this.release(e), { signal: this.signal });
      window.addEventListener("pointercancel", (e) => this.release(e, true), { signal: this.signal });
      window.addEventListener("blur", () => this.cancel(), { signal: this.signal });
      window.addEventListener("resize", () => this.reflow(), { signal: this.signal });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.cancel(true);
      }, { signal: this.signal });
      document.addEventListener("click", (e) => {
        if (this.blockClick && performance.now() < this.blockClick.until && this.blockClick.source.contains(e.target)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.blockClick = null;
        }
      }, { capture: true, signal: this.signal });
    }
    register(element, { source = element, mode = "tether", maxTravel = Infinity, onCommit, segments, onPosition } = {}) {
      const body = {
        element,
        source,
        mode,
        maxTravel,
        onCommit,
        segments,
        onPosition,
        x: new Spring(),
        y: new Spring(),
        press: new Spring(),
        stretch: new Spring(),
        bendX: new Spring(),
        bendY: new Spring(),
        angle: 0,
        held: false,
        freeX: 0,
        freeY: 0,
        optical: { bend: [0, 0], pressure: 0, energy: 0 }
      };
      this.bodies.set(element, body);
      element.dataset.jelly = mode;
      element.style.setProperty("--jelly-matrix", "matrix(1,0,0,1,0,0)");
      source.addEventListener("pointerdown", (e) => this.grab(body, e), { signal: this.signal });
      source.addEventListener("lostpointercapture", (e) => {
        if (this.gesture?.id === e.pointerId) this.release(e, true);
      }, { signal: this.signal });
      return body;
    }
    grab(body, e) {
      if (e.button !== 0 || !e.isPrimary || this.gesture || body.source.disabled || body.source.getAttribute("aria-disabled") === "true") return;
      if (["tether", "press"].includes(body.mode) && body.source === body.element && !body.element.matches("button")) {
        const interactive = e.target.closest("button,input,a,[role=slider],[data-jelly],[data-optical-drag]");
        if (interactive && interactive !== body.element) return;
      }
      const boundary = body.mode === "free" ? body.element.parentElement : this.stage;
      const r = body.element.getBoundingClientRect(), sr = boundary.getBoundingClientRect();
      const capture = body.mode === "segment" ? e.target.closest("button") || body.source : body.source;
      this.gesture = {
        body,
        boundary,
        capture,
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: body.mode === "toggle" ? body.x.value : body.x.target,
        restX: body.x.target,
        baseY: body.y.target,
        rect: { left: r.left - sr.left - body.x.value, top: r.top - sr.top - body.y.value, right: r.right - sr.left - body.x.value, bottom: r.bottom - sr.top - body.y.value },
        moved: false
      };
      body.held = true;
      body.press.target = 1;
      body.element.dataset.held = "true";
      if (!["range", "press"].includes(body.mode)) {
        e.preventDefault();
        capture.setPointerCapture(e.pointerId);
      }
      if (capture.matches("button,[tabindex]")) capture.focus({ preventScroll: true });
      this.wake();
    }
    move(e) {
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      const b = g.body, dx = e.clientX - g.startX, dy = e.clientY - g.startY;
      const wasMoved = g.moved;
      g.moved || (g.moved = Math.hypot(dx, dy) > 5);
      if (g.moved && !wasMoved) b.source.dispatchEvent(new CustomEvent("lg:gesture", { bubbles: true, detail: { phase: "drag", mode: b.mode, moved: true } }));
      if (b.mode === "press") {
        b.x.target = clamp(dx * 0.12, -5, 5);
        b.y.target = clamp(dy * 0.12, -5, 5);
      } else if (b.mode === "range") {
        b.y.target = clamp(dy * 0.35, -18, 18);
      } else if (b.mode === "toggle") {
        b.x.target = clamp(g.baseX + dx, 0, this.toggleTravel(b.source));
        b.y.target = 0;
      } else if (b.mode === "segment") {
        const box = b.source.getBoundingClientRect();
        b.x.target = clamp(e.clientX - box.left - b.element.offsetWidth / 2, 3, b.source.clientWidth - b.element.offsetWidth - 3);
        b.y.target = clamp(dy * 0.25, -10, 10);
      } else {
        const bound = boundDrag(g.baseX + dx, g.baseY + dy, g.rect, { width: g.boundary.clientWidth, height: g.boundary.clientHeight }, 22);
        b.x.target = clamp(bound.x, -b.maxTravel, b.maxTravel);
        b.y.target = clamp(bound.y, -b.maxTravel, b.maxTravel);
      }
      if (!["range", "press"].includes(b.mode)) e.preventDefault();
      this.wake();
    }
    release(e, cancelled = false) {
      const g = this.gesture;
      if (!g || e && g.id !== e.pointerId) return;
      this.gesture = null;
      const b = g.body;
      b.held = false;
      b.press.target = 0;
      delete b.element.dataset.held;
      if (g.moved && !["range", "press"].includes(b.mode)) this.blockClick = { source: b.source, until: performance.now() + 350 };
      if (g.capture.hasPointerCapture?.(g.id)) g.capture.releasePointerCapture(g.id);
      if (["tether", "press"].includes(b.mode)) {
        b.x.target = 0;
        b.y.target = 0;
      }
      if (b.mode === "free") {
        if (cancelled) {
          b.x.target = b.freeX;
          b.y.target = b.freeY;
        } else {
          b.freeX = b.x.target;
          b.freeY = b.y.target;
          b.onPosition?.(b.freeX, b.freeY);
        }
      }
      if (b.mode === "range") b.y.target = 0;
      if (b.mode === "toggle") {
        if (g.moved && !cancelled) b.onCommit?.(b.x.target >= this.toggleTravel(b.source) / 2);
        else b.x.target = g.restX;
        b.y.target = 0;
      }
      if (b.mode === "segment") {
        if (g.moved && !cancelled) {
          const center = b.x.target + b.element.offsetWidth / 2;
          const selected = b.segments().reduce((a, c) => Math.abs(c.offsetLeft + c.offsetWidth / 2 - center) < Math.abs(a.offsetLeft + a.offsetWidth / 2 - center) ? c : a);
          b.onCommit?.(selected);
        } else b.x.target = g.baseX;
        b.y.target = 0;
      }
      b.source.dispatchEvent(new CustomEvent("lg:gesture", { bubbles: true, detail: { phase: cancelled ? "cancel" : "end", mode: b.mode, moved: g.moved } }));
      this.wake();
    }
    target(element, x, y = 0, { snap = false } = {}) {
      const b = this.bodies.get(element);
      if (!b) return;
      b.x.target = x;
      b.y.target = y;
      if (b.mode === "free") {
        b.freeX = x;
        b.freeY = y;
      }
      if (snap) {
        b.x.snap();
        b.y.snap();
      }
      this.wake();
    }
    pulse(element, amount = 0.45) {
      const b = this.bodies.get(element);
      if (!b) return;
      b.press.velocity = clamp(b.press.velocity + amount * 8, -4, 4);
      b.stretch.velocity = clamp(b.stretch.velocity + amount * 1.2, -1.5, 1.5);
      this.wake();
    }
    setIntensity(value, explicit = false) {
      this.intensity = clamp(value, 0, 1);
      if (explicit) this.reduced = false;
      this.wake();
    }
    toggleTravel(source) {
      const thumb = source.querySelector('[data-glass="thumb"]');
      if (!thumb) return 0;
      const inset = parseFloat(getComputedStyle(thumb).left) || 3;
      return Math.max(0, source.clientWidth - thumb.offsetWidth - inset * 2);
    }
    toggleProgress(source) {
      const body = this.bodies.get(source.querySelector('[data-glass="thumb"]'));
      return clamp((body?.x.value || 0) / Math.max(1, this.toggleTravel(source)), 0, 1);
    }
    optics(element) {
      return this.bodies.get(element)?.optical || { bend: [0, 0], pressure: 0, energy: 0 };
    }
    cancel(snap = false) {
      this.release(null, true);
      if (snap) {
        for (const b of this.bodies.values()) for (const k of ["x", "y", "press", "stretch", "bendX", "bendY"]) b[k].snap();
      }
      this.wake();
    }
    reflow() {
      this.cancel();
      for (const b of this.bodies.values()) if (b.mode === "free") {
        const parent = b.element.parentElement, w = parent.clientWidth, h = parent.clientHeight;
        if (!w || !h) continue;
        const maxX = Math.max(0, (w - b.element.offsetWidth) / 2 - 22), maxY = Math.max(0, (h - b.element.offsetHeight) / 2 - 22);
        b.x.target = b.freeX = clamp(b.freeX, -maxX, maxX);
        b.y.target = b.freeY = clamp(b.freeY, -maxY, maxY);
        b.onPosition?.(b.freeX, b.freeY);
      }
      this.wake();
    }
    reset() {
      this.cancel();
      for (const b of this.bodies.values()) {
        if (["tether", "free", "press"].includes(b.mode)) {
          b.x.target = b.y.target = b.freeX = b.freeY = 0;
        }
        b.press.target = 0;
      }
      this.wake();
    }
    wake() {
      if (!this.frame && !this.destroyed) this.frame = requestAnimationFrame((now) => this.tick(now));
    }
    tick(now) {
      this.frame = 0;
      const dt = this.last ? Math.min((now - this.last) / 1e3, 0.05) : 1 / 60;
      this.last = now;
      const amount = this.intensity * (this.reduced ? 0.65 : 1);
      let moving = false;
      for (const b of this.bodies.values()) {
        if (!b.element.getClientRects().length) continue;
        const damping = this.reduced ? 34 : b.mode === "toggle" ? 26 : b.held ? 22 : 17;
        b.x.step(dt, b.mode === "range" ? 380 : 260, damping);
        b.y.step(dt, 260, damping);
        b.press.step(dt, 310, this.reduced ? 32 : 18);
        const speed = Math.hypot(b.x.velocity, b.y.velocity);
        if (speed > 16) b.angle = Math.atan2(b.y.velocity, b.x.velocity);
        const normalized = Math.min(speed / (b.mode === "range" ? 1700 : 2400), 0.25);
        b.stretch.target = normalized * amount;
        b.stretch.step(dt, 230, this.reduced ? 30 : 15);
        b.bendX.target = clamp((b.x.target - b.x.value) * 0.12, -11, 11) * amount;
        b.bendY.target = clamp((b.y.target - b.y.value) * 0.12, -11, 11) * amount;
        b.bendX.step(dt, 190, this.reduced ? 28 : 14);
        b.bendY.step(dt, 190, this.reduced ? 28 : 14);
        const pressure = clamp(b.press.value, 0, 1.16);
        const lift = 1 + pressure * amount * (b.mode === "range" ? 0.2 : 0.035);
        let m = jellyMatrix(b.stretch.value, b.angle, lift), x = b.x.value, y = b.y.value;
        if (b.mode === "toggle") {
          const pose = togglePose(x, this.toggleTravel(b.source), b.element.offsetWidth, pressure * amount, b.stretch.value);
          m = [pose.scaleX, 0, 0, pose.scaleY];
          x = pose.x;
          y = 0;
        }
        b.element.style.setProperty("--jelly-matrix", `matrix(${m.map((v) => v.toFixed(5)).join(",")},${x.toFixed(3)},${y.toFixed(3)})`);
        b.optical = { bend: b.mode === "toggle" ? [0, 0] : [b.bendX.value, b.bendY.value], pressure, energy: Math.abs(b.stretch.value) + Math.hypot(b.bendX.value, b.bendY.value) * 0.015 };
        const active = ["x", "y", "press", "stretch", "bendX", "bendY"].some((k) => b[k].moving);
        b.element.classList.toggle("jelly-moving", active || b.held);
        moving || (moving = active);
      }
      this.renderer?.invalidate();
      if (moving) this.wake();
      else this.last = 0;
    }
    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.frame);
      this.abort.abort();
    }
  };

  // src/appearance/liquid-glass.js
  function paintScene(ctx, { width, height }) {
    const style = getComputedStyle(document.documentElement);
    const color = (token) => style.getPropertyValue(token).trim();
    const wash = ctx.createRadialGradient(width * 0.35, height * 0.24, 0, width * 0.35, height * 0.24, Math.max(width, height) * 0.85);
    wash.addColorStop(0, color("--studio-surface"));
    wash.addColorStop(1, color("--studio-bg"));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);
  }
  function paintDock(source) {
    const dock = document.querySelector(".dock-material");
    if (!dock || !dock.offsetWidth) return;
    const box = dock.getBoundingClientRect(), scene = source.getBoundingClientRect();
    const sx = source.width / scene.width, sy = source.height / scene.height;
    const w = Math.max(1, Math.round(box.width * sx)), h = Math.max(1, Math.round(box.height * sy));
    if (dock.width !== w || dock.height !== h) {
      dock.width = w;
      dock.height = h;
    }
    dock.getContext("2d").drawImage(source, (box.x - scene.x) * sx, (box.y - scene.y) * sy, w, h, 0, 0, w, h);
  }
  function start() {
    const stage = document.body;
    const root = document.documentElement;
    const acrylic = window.lumeDesktop?.platform === "Windows" || stage.querySelector("#root") && /Windows/i.test(navigator.userAgent);
    stage.classList.toggle("acrylic", Boolean(acrylic));
    let canvas;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const reducedTransparency = matchMedia("(prefers-reduced-transparency: reduce)");
    let renderer, jelly, sceneKey = "";
    function sync() {
      const reduced = root.dataset.glass === "reduced" || reducedTransparency.matches;
      if (reduced) {
        jelly?.destroy();
        renderer?.destroy();
        jelly = renderer = void 0;
        canvas?.remove();
        canvas = void 0;
        stage.classList.remove("webgl-ready", "fallback", "liquid-stage");
        return;
      }
      stage.classList.add("liquid-stage");
      if (!acrylic && !renderer) {
        canvas = document.createElement("canvas");
        canvas.className = "lume-optics";
        canvas.setAttribute("aria-hidden", "true");
        stage.prepend(canvas);
        renderer = new GlassRenderer(canvas, stage, {
          scene: "ocean",
          artwork: paintScene,
          afterRender: stage.querySelector("#root") ? paintDock : void 0,
          motion: false,
          brightness: 1,
          refraction: 1.12,
          dispersion: 0.88,
          blur: 0.08
        });
        sceneKey = "";
      }
      if (!jelly) {
        jelly = new JellyController(stage, renderer, { intensity: 0.85 });
        renderer?.setMotionSource(jelly);
      }
      jelly.reduced = reducedMotion.matches;
      if (renderer) renderer.reducedMotion = reducedMotion.matches;
      const palette = [root.dataset.phoneTheme, root.dataset.customSkin, ...["background", "surface", "accent"].map((k) => root.style.getPropertyValue("--skin-" + k))].join("|");
      if (sceneKey !== palette) {
        sceneKey = palette;
        renderer?.setScene("ocean");
        const fallback = document.createElement("canvas");
        fallback.width = 650;
        fallback.height = 650;
        paintScene(fallback.getContext("2d"), fallback);
        stage.style.setProperty("--liquid-wallpaper", "url(" + fallback.toDataURL("image/jpeg", 0.89) + ")");
      }
      renderer?.invalidate();
    }
    if (document.getElementById("full")) window.lumePlayerTransition = (active) => {
      if (!renderer) return;
      renderer.transitionPaused = active;
      if (active) {
        cancelAnimationFrame(renderer.frame);
        renderer.frame = 0;
      } else renderer.invalidate();
    };
    stage.addEventListener("pointerdown", (event) => {
      const target = event.target.closest("[data-elastic]");
      if (!jelly || !target || target.disabled || target.closest("[data-lens-group]")) return;
      for (const element of jelly.bodies.keys()) if (!element.isConnected) jelly.bodies.delete(element);
      if (!jelly.bodies.has(target)) jelly.register(target, { mode: target.dataset.elastic, maxTravel: 12 });
    }, true);
    installSelectionMotion(stage, (duration) => renderer?.invalidate(duration));
    stage.addEventListener("pointerdown", () => {
      stage.dataset.inputMode = "pointer";
    }, true);
    stage.addEventListener("keydown", (e) => {
      if (e.key === "Tab" || e.key.startsWith("Arrow")) stage.dataset.inputMode = "keyboard";
    }, true);
    sync();
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-glass", "data-custom-skin", "data-phone-theme", "style"] });
    reducedMotion.addEventListener("change", sync);
    reducedTransparency.addEventListener("change", sync);
  }
  if (document.getElementById("seek")) window.lumeBindRange = bindRangeDrag;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
