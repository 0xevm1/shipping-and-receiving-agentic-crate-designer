(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const showError = (msg) => { const e = $('#err'); e.style.display = 'block'; e.textContent = 'The 3D view hit a problem: ' + msg; };
window.addEventListener('error', (e) => showError(e.message + (e.lineno ? ' (line ' + e.lineno + ')' : '')));

/* ================= State ================= */
const DEFAULT_RULES = { keepUpright: true, maxLayers: 2, partGapMm: 50, wallClearanceMm: 50, panelThickness: 'auto' };
const PARTS = CATALOG.parts;
const state = {
  partId: null, quantity: 4, ...DEFAULT_RULES, layoutKey: null, units: 'mm', tab: 'overview', showAll: false,
  view: { lid: false, front: false, lidA: 0, frontA: 0, blocking: true, parts: true, dims: true, explode: 0 },
  hover: null, pin: null,
};
let result = null, explodeGoal = null, lastExtKey = '', hudOn = true;
let current = null;
const part = () => current;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Idle behaviour: the crate turns and steps through closed, open and exploded until someone touches the page. */
const IDLE_MS = 6000, TURN = 0.3;
const auto = { on: !reduceMotion, rev: 0, fired: false, slow: false, step: -1 };
/* Idle sequence: every mode holds for half a turn. */
const SEQ = ['closed', 'exploded', 'open', 'exploded'], LEAD = Math.PI * 2 * 0.12;
const stepTurn = () => Math.PI;
let lastInput = -Infinity;
const touched = () => { lastInput = performance.now(); auto.on = false; auto.slow = false; };
for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) window.addEventListener(ev, touched, { passive: true, capture: true });

/* ================= Formatting ================= */
const imp = () => state.units === 'in';
const unit = () => imp() ? 'in' : 'mm';
const len = (mm) => imp() ? (mm / 25.4).toFixed(1) : String(Math.round(mm));
const dims = (a) => a.map(len).join(' × ');
const dimsOther = (a) => imp() ? a.map(v => Math.round(v)).join(' × ') + ' mm' : a.map(v => (v / 25.4).toFixed(1)).join(' × ') + ' in';
const wt = (kg) => imp() ? Math.round(kg * 2.20462) + ' lb' : Math.round(kg) + ' kg';
const vol = (m3) => imp() ? (m3 * 35.3147).toFixed(1) + ' ft³' : m3.toFixed(2) + ' m³';
const frac = (mm) => {
  let s = Math.round(mm / 25.4 * 16), w = Math.floor(s / 16), r = s % 16, d = 16;
  while (r && r % 2 === 0) { r /= 2; d /= 2; }
  return (w || !r ? w : '') + (r ? (w ? ' ' : '') + r + '/' + d : '') + '″';
};
const cutLen = (mm) => imp() ? frac(mm) : String(Math.round(mm));
const describe = (l) => {
  const [nx, ny, nz] = l.counts, n = l.slots.length;
  if (n === 1) return 'Single part';
  if (nz > 1) return (nx * ny === 1 ? '1' : nx + ' × ' + ny) + ' per layer, ' + nz + ' layers';
  return ny === 1 ? nx + ' in a row' : nx + ' × ' + ny + ', one layer';
};

/* ================= Part meshes from GLB files ================= */
function parseGlb(bin) {
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  if (bin.length < 28 || dv.getUint32(0, true) !== 0x46546C67) throw new Error('That is not a .glb file.');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bin.subarray(20, 20 + jsonLen)));
  if ((json.extensionsRequired || []).some(e => /draco|meshopt/i.test(e))) throw new Error('This file is compressed in a way this viewer cannot read. Export it without Draco or Meshopt compression.');
  const binStart = 20 + jsonLen + 8;
  const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const GET = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
  const read = (idx) => {
    const a = json.accessors[idx]; if (!a || a.bufferView === undefined) throw new Error('This file stores its geometry in a way this viewer cannot read.');
    const bv = json.bufferViews[a.bufferView], comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type], cs = SIZE[a.componentType], get = GET[a.componentType];
    const stride = bv.byteStride || comps * cs, base = binStart + (bv.byteOffset || 0) + (a.byteOffset || 0), data = new Float64Array(a.count * comps);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) data[i * comps + c] = dv[get](base + i * stride + c * cs, true);
    return { data, comps, norm: a.componentType === 5121 ? 255 : a.componentType === 5123 ? 65535 : 1 };
  };
  const nodeMat = (n) => {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], sc = n.scale || [1, 1, 1], x = q[0], y = q[1], z = q[2], w = q[3];
    return [(1 - 2 * (y * y + z * z)) * sc[0], 2 * (x * y + z * w) * sc[0], 2 * (x * z - y * w) * sc[0], 0,
      2 * (x * y - z * w) * sc[1], (1 - 2 * (x * x + z * z)) * sc[1], 2 * (y * z + x * w) * sc[1], 0,
      2 * (x * z + y * w) * sc[2], 2 * (y * z - x * w) * sc[2], (1 - 2 * (x * x + y * y)) * sc[2], 0, t[0], t[1], t[2], 1];
  };
  const P = [], N = [], C = [], COS = Math.cos(40 * Math.PI / 180);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const addMesh = (mesh, M) => { for (const prim of mesh.primitives) {
    if (prim.mode !== undefined && prim.mode !== 4) continue;
    const src = read(prim.attributes.POSITION).data, pos = new Float64Array(src.length);
    for (let i = 0; i < src.length; i += 3) for (let r = 0; r < 3; r++) pos[i + r] = M[r] * src[i] + M[4 + r] * src[i + 1] + M[8 + r] * src[i + 2] + M[12 + r];
    const col = prim.attributes.COLOR_0 !== undefined ? read(prim.attributes.COLOR_0) : null;
    const mat = prim.material !== undefined && json.materials && json.materials[prim.material];
    const base = mat && mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorFactor || [0.62, 0.66, 0.70];
    const idx = prim.indices !== undefined ? read(prim.indices).data : Float64Array.from({ length: pos.length / 3 }, (_, i) => i);
    const nt = Math.floor(idx.length / 3), fn = new Float32Array(nt * 3), byVert = new Map();
    for (let f = 0; f < nt; f++) {
      const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
      fn[f * 3] = nx / l; fn[f * 3 + 1] = ny / l; fn[f * 3 + 2] = nz / l;
      for (let k = 0; k < 3; k++) { const v = idx[f * 3 + k]; if (!byVert.has(v)) byVert.set(v, []); byVert.get(v).push(f); }
    }
    for (let f = 0; f < nt; f++) for (let k = 0; k < 3; k++) {
      const v = idx[f * 3 + k]; let sx = 0, sy = 0, sz = 0;
      for (const g of byVert.get(v)) {
        if (fn[g * 3] * fn[f * 3] + fn[g * 3 + 1] * fn[f * 3 + 1] + fn[g * 3 + 2] * fn[f * 3 + 2] > COS) { sx += fn[g * 3]; sy += fn[g * 3 + 1]; sz += fn[g * 3 + 2]; }
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      N.push(sx / l, sy / l, sz / l);
      for (let d = 0; d < 3; d++) { const p = pos[v * 3 + d]; P.push(p); if (p < mn[d]) mn[d] = p; if (p > mx[d]) mx[d] = p; }
      if (col) C.push(col.data[v * col.comps] / col.norm, col.data[v * col.comps + 1] / col.norm, col.data[v * col.comps + 2] / col.norm);
      else C.push(base[0], base[1], base[2]);
    }
  } };
  const visit = (i, M, depth) => {
    const n = json.nodes[i]; if (!n || depth > 32) return;
    const W = mul4(M, nodeMat(n));
    if (n.mesh !== undefined && json.meshes[n.mesh]) addMesh(json.meshes[n.mesh], W);
    (n.children || []).forEach(c => visit(c, W, depth + 1));
  };
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = json.scenes && json.scenes[json.scene || 0];
  if (scene && scene.nodes && json.nodes) scene.nodes.forEach(i => visit(i, I4, 0));
  else (json.meshes || []).forEach(m => addMesh(m, I4));
  if (!P.length) throw new Error('No solid geometry was found in this file.');
  // Models are expected in metres. A part tens of metres long was almost certainly drawn in millimetres.
  const inMm = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) > 20, k = inMm ? 0.001 : 1;
  const pos = new Float32Array(P.length); for (let i = 0; i < P.length; i++) pos[i] = P[i] * k;
  return { pos, nrm: new Float32Array(N), col: new Float32Array(C), count: P.length / 3, inMm,
    center: [0, 1, 2].map(i => (mn[i] + mx[i]) / 2 * k), sizeMm: [0, 1, 2].map(i => (mx[i] - mn[i]) * k * 1000) };
}
const MESH = {};

/* ================= Tiny vector and matrix helpers (column-major) ================= */
const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
const perspective = (fovy, aspect, near, far) => { const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]; };
const lookAt = (eye, x, y, z) => [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, eye), -V.dot(y, eye), -V.dot(z, eye), 1];
const mul4 = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };

/* ================= WebGL ================= */
const canvas = $('#gl'), stage = $('#stage');
const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
if (!gl) { showError('WebGL is not available in this view.'); return; }
function program(vs, fs, attribs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}
const meshProg = program(`
attribute vec3 aPos; attribute vec3 aNormal; attribute vec3 aColor;
uniform mat4 uVP; uniform mat4 uModel; uniform mat3 uRot;
varying vec3 vN; varying vec3 vW; varying vec3 vC;
void main(){ vec4 w = uModel * vec4(aPos, 1.0); vW = w.xyz; vN = uRot * aNormal; vC = aColor; gl_Position = uVP * w; }`, `
precision highp float;
uniform vec3 uColor; uniform float uAlpha; uniform float uSpec; uniform vec3 uEye;
varying vec3 vN; varying vec3 vW; varying vec3 vC;
void main(){
  vec3 n = normalize(vN);
  vec3 l1 = normalize(vec3(0.45, -0.55, 0.75)); vec3 l2 = normalize(vec3(-0.6, 0.5, 0.3));
  vec3 amb = mix(vec3(0.46, 0.47, 0.50), vec3(0.72, 0.73, 0.74), 0.5 + 0.5 * n.z);
  vec3 c = uColor * vC * (amb + max(dot(n, l1), 0.0) * vec3(0.50, 0.48, 0.44) + vec3(max(dot(n, l2), 0.0) * 0.14));
  vec3 h = normalize(l1 + normalize(uEye - vW));
  c += vec3(uSpec * pow(max(dot(n, h), 0.0), 28.0));
  gl_FragColor = vec4(c, uAlpha);
}`, ['aPos', 'aNormal', 'aColor']);
const lineProg = program(`
attribute vec3 aPos; uniform mat4 uVP; uniform mat4 uModel; varying vec3 vW;
void main(){ vec4 w = uModel * vec4(aPos, 1.0); vW = w.xyz; gl_Position = uVP * w; }`, `
precision highp float;
uniform vec4 uColor; uniform vec3 uFade; varying vec3 vW;
void main(){ float a = uColor.a; if (uFade.z > 0.0) a *= 1.0 - smoothstep(uFade.z * 0.35, uFade.z, distance(vW.xy, uFade.xy)); gl_FragColor = vec4(uColor.rgb, a); }`, ['aPos']);
const shadowProg = program(`
attribute vec3 aPos; uniform mat4 uVP; uniform mat4 uModel; varying vec2 vP;
void main(){ vec4 w = uModel * vec4(aPos, 1.0); vP = w.xy; gl_Position = uVP * w; }`, `
precision highp float;
uniform vec2 uC; uniform vec2 uHalf; uniform float uSoft; varying vec2 vP;
void main(){ vec2 d = max(abs(vP - uC) - uHalf, 0.0); float a = 1.0 - smoothstep(0.0, uSoft, length(d)); gl_FragColor = vec4(1.0, 0.85, 0.64, 0.15 * a * a); }`, ['aPos']);
const bgProg = program(`
attribute vec3 aPos; varying vec2 vUv;
void main(){ vUv = aPos.xy; gl_Position = vec4(aPos.xy * 2.0 - 1.0, 0.0, 1.0); }`, `
precision highp float;
varying vec2 vUv;
void main(){ vec3 c = mix(vec3(0.088, 0.074, 0.060), vec3(0.047, 0.086, 0.130), smoothstep(0.05, 0.95, vUv.y)); float v = distance(vUv, vec2(0.5, 0.48)); gl_FragColor = vec4(c * (1.0 - 0.55 * v * v), 1.0); }`, ['aPos']);

const buf = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data instanceof Float32Array ? data : new Float32Array(data), gl.STATIC_DRAW); return b; };
const cube = (() => {
  const P = [], N = [], E = [];
  for (let d = 0; d < 3; d++) for (const s of [0, 1]) {
    const u = (d + 1) % 3, v = (d + 2) % 3, n = [0, 0, 0]; n[d] = s ? 1 : -1;
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) { const p = [0, 0, 0]; p[d] = s; p[u] = a; p[v] = b; P.push(...p); N.push(...n); }
  }
  for (let d = 0; d < 3; d++) for (const a of [0, 1]) for (const b of [0, 1]) {
    const p = [0, 0, 0], q = [0, 0, 0]; p[(d + 1) % 3] = q[(d + 1) % 3] = a; p[(d + 2) % 3] = q[(d + 2) % 3] = b; q[d] = 1; E.push(...p, ...q);
  }
  return { pos: buf(P), nrm: buf(N), edge: buf(E), quad: buf([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]) };
})();
const upload = (m) => { m.bPos = buf(m.pos); m.bNrm = buf(m.nrm); m.bCol = buf(m.col); return m; };
const dynLines = gl.createBuffer();

const boxModel = (min, size) => [size[0], 0, 0, 0, 0, size[1], 0, 0, 0, 0, size[2], 0, min[0], min[1], min[2], 1];
const ID3 = [1, 0, 0, 0, 1, 0, 0, 0, 1], ID4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function partModel(mesh, R, center) { // T(center) · R · S(1000) · T(-meshCenter); R is row-major
  const c = mesh.center, m = new Array(16).fill(0);
  for (let j = 0; j < 3; j++) for (let r = 0; r < 3; r++) m[j * 4 + r] = R[r * 3 + j] * 1000;
  for (let r = 0; r < 3; r++) m[12 + r] = center[r] - 1000 * (R[r * 3] * c[0] + R[r * 3 + 1] * c[1] + R[r * 3 + 2] * c[2]);
  m[15] = 1; return m;
}
const rot3cols = (R) => [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];

function useMesh(vp, eye) {
  gl.useProgram(meshProg.p); gl.uniformMatrix4fv(meshProg.u.uVP, false, vp); gl.uniform3fv(meshProg.u.uEye, eye);
  gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
}
function drawBox(model, color, alpha) {
  gl.bindBuffer(gl.ARRAY_BUFFER, cube.pos); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, cube.nrm); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.disableVertexAttribArray(2); gl.vertexAttrib3f(2, 1, 1, 1);
  gl.uniformMatrix4fv(meshProg.u.uModel, false, model); gl.uniformMatrix3fv(meshProg.u.uRot, false, ID3);
  gl.uniform3fv(meshProg.u.uColor, color); gl.uniform1f(meshProg.u.uAlpha, alpha); gl.uniform1f(meshProg.u.uSpec, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 36);
}
function drawPart(mesh, model, R, tint, alpha) {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.bPos); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.bNrm); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(2); gl.bindBuffer(gl.ARRAY_BUFFER, mesh.bCol); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(meshProg.u.uModel, false, model); gl.uniformMatrix3fv(meshProg.u.uRot, false, rot3cols(R));
  gl.uniform3fv(meshProg.u.uColor, tint); gl.uniform1f(meshProg.u.uAlpha, alpha); gl.uniform1f(meshProg.u.uSpec, alpha < 1 ? 0 : 0.28);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  gl.disableVertexAttribArray(2); gl.vertexAttrib3f(2, 1, 1, 1);
}
function useLines(vp) {
  gl.useProgram(lineProg.p); gl.uniformMatrix4fv(lineProg.u.uVP, false, vp);
  gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2); gl.enableVertexAttribArray(0);
  gl.uniform3f(lineProg.u.uFade, 0, 0, 0);
}
function drawEdges(model, rgba) {
  gl.bindBuffer(gl.ARRAY_BUFFER, cube.edge); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(lineProg.u.uModel, false, model); gl.uniform4fv(lineProg.u.uColor, rgba); gl.drawArrays(gl.LINES, 0, 24);
}
function drawLineList(pts, rgba) {
  gl.bindBuffer(gl.ARRAY_BUFFER, dynLines); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(lineProg.u.uModel, false, ID4); gl.uniform4fv(lineProg.u.uColor, rgba); gl.drawArrays(gl.LINES, 0, pts.length / 3);
}

/* ================= Camera ================= */
const FOV = 34 * Math.PI / 180;
const cam = { t: [0, 0, 0], az: -1.02, el: 0.46, d: 3000, goal: null };
let dirty = true;
function camBasis(c) {
  const dir = [Math.cos(c.el) * Math.cos(c.az), Math.cos(c.el) * Math.sin(c.az), Math.sin(c.el)];
  const eye = V.add(c.t, V.mul(dir, c.d)), z = dir;
  let x = V.cross([0, 0, 1], z); x = V.norm(Math.hypot(x[0], x[1], x[2]) < 1e-4 ? [-Math.sin(c.az), Math.cos(c.az), 0] : x);
  return { eye, x, y: V.cross(z, x), z };
}
/* The panels cover part of the view, so the crate is centred in the space they leave free. */
function freeArea() {
  const W = Math.max(1, canvas.clientWidth), H = Math.max(1, canvas.clientHeight);
  if (!hudOn || window.innerWidth <= 980) return { sx: 0, sy: 0, w: W, h: H };
  const side = $('#side').offsetWidth + 56, l = 40, r = W - side, t = 96, b = H - 100;
  return { sx: ((l + r) / 2 - W / 2) / (W / 2), sy: -((t + b) / 2 - H / 2) / (H / 2), w: Math.max(240, r - l), h: Math.max(240, b - t) };
}
function viewProj(c, aspect) {
  const b = camBasis(c), f = freeArea();
  const shift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, f.sx, f.sy, 0, 1];
  return { vp: mul4(shift, mul4(perspective(FOV, aspect, c.d * 0.05, c.d * 12), lookAt(b.eye, b.x, b.y, b.z))), b };
}
const VIEWS = { iso: { az: -1.02, el: 0.46 }, top: { az: -Math.PI / 2, el: Math.PI / 2 - 0.002 }, front: { az: -Math.PI / 2, el: 0.02 }, end: { az: Math.PI, el: 0.02 } };
let camView = 'iso';
function fitGoal(viewName, explode) {
  const ext = result.design.layout.external, mn = crateMin(), e = explode;
  const pad = state.view.dims ? 2 * (110 + Math.max(ext[0], ext[1], ext[2]) * 0.05) + 160 : 0;
  const size = [ext[0] + 640 * e + pad, ext[1] + 640 * e + pad, ext[2] + 420 * e];
  const center = [mn[0] + ext[0] / 2, mn[1] + ext[1] / 2, mn[2] + ext[2] / 2 + 210 * e];
  const f = freeArea(), H = Math.max(1, canvas.clientHeight), th = Math.tan(FOV / 2);
  const half = Math.min(Math.atan(th * f.h / H), Math.atan(th * f.w / H));
  const r = Math.hypot(size[0], size[1], size[2]) / 2;
  const v = VIEWS[viewName || camView] || cam;
  return { t: center, az: v.az, el: v.el, d: r / Math.sin(half) * 0.9 };
}
function goTo(goal, instant) {
  if (auto.on) goal = { ...goal, az: cam.az };
  if (instant || reduceMotion) { Object.assign(cam, goal, { goal: null }); } else {
    let da = goal.az - cam.az; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    cam.goal = { ...goal, az: cam.az + da };
  }
  dirty = true;
}

/* ================= Scene ================= */
const COLORS = {
  floor: [0.80, 0.68, 0.49], skid: [0.62, 0.45, 0.27], side: [0.87, 0.76, 0.57], end: [0.87, 0.76, 0.57], lid: [0.89, 0.79, 0.60],
  cleat: [0.76, 0.57, 0.34], 'lid-cleat': [0.76, 0.57, 0.34], separator: [0.92, 0.84, 0.68], bearer: [0.52, 0.32, 0.17], blocking: [0.52, 0.32, 0.17],
};
const HL = [0.42, 0.78, 1.0];
function crateMin() { const c = result.design.construction, o = c.panelMm + Domain.CT; return [-o, -o, -c.floorMm - c.skid.tall]; }
function explodeOffset(face, e) {
  switch (face) {
    case 'side-': return [0, -320 * e, 0]; case 'side+': return [0, 320 * e, 0];
    case 'end-': return [-320 * e, 0, 0]; case 'end+': return [320 * e, 0, 0];
    case 'lid': return [0, 0, 420 * e]; default: return [0, 0, 0];
  }
}
function highlight() {
  const keys = new Set();
  if (state.pin) keys.add(state.pin);
  if (state.hover) keys.add(state.hover.key);
  return { keys, asm: state.hover ? state.hover.asm : undefined, focus: !!state.pin || !!(state.hover && state.hover.source === 'list') };
}
function memberAlpha(m) {
  const v = state.view;
  if (m.face === 'lid') return v.lidA;
  if (m.face === 'side-') return v.frontA;
  if (m.asm === 'inside') return v.blocking ? 1 : 0;
  return 1;
}
function sceneObjects() {
  const hl = highlight(), e = state.view.explode, out = [];
  for (const m of result.design.members) {
    const isHl = hl.keys.has(m.bomKey) || m.asm === hl.asm;
    let alpha = memberAlpha(m); if (isHl && hl.focus) alpha = 1;
    if (alpha < 0.01) continue;
    out.push({ type: 'box', m, min: V.add(m.min, explodeOffset(m.face, e)), size: m.size, hl: isHl, ghost: hl.focus && !isHl, alpha });
  }
  if (state.view.parts) {
    const L = result.design.layout, R = Domain.rotation(L.orientation), mesh = MESH[state.partId];
    L.slots.forEach((s, i) => out.push({ type: 'part', i, min: s.min, size: L.cellSize, R, mesh, center: s.min.map((v, k) => v + L.cellSize[k] / 2), ghost: hl.focus, alpha: 1 }));
  }
  return out;
}

const BG = [0.05, 0.08, 0.11];
const gridStep = () => imp() ? 304.8 : 500;
function draw() {
  const w = canvas.width, h = canvas.height;
  gl.viewport(0, 0, w, h); gl.clearColor(BG[0], BG[1], BG[2], 1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.useProgram(bgProg.p); gl.enableVertexAttribArray(0);
  gl.bindBuffer(gl.ARRAY_BUFFER, cube.quad); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (!result) return;
  const { vp, b } = viewProj(cam, w / h), objs = sceneObjects();
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.depthMask(true);

  useMesh(vp, b.eye); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
  for (const o of objs) if (!o.ghost && o.alpha > 0.99) {
    if (o.type === 'box') drawBox(boxModel(o.min, o.size), o.hl ? HL : COLORS[o.m.kind], 1);
    else drawPart(o.mesh, partModel(o.mesh, o.R, o.center), o.R, [1.12, 1.12, 1.12], 1);
  }
  gl.disable(gl.POLYGON_OFFSET_FILL);

  gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  useLines(vp);
  for (const o of objs) if (!o.ghost && o.alpha > 0.99 && o.type === 'box') drawEdges(boxModel(o.min, o.size), o.hl ? [0.88, 0.96, 1.0, 0.95] : [0.16, 0.10, 0.04, 0.55]);
  gl.depthMask(false);

  // floor: soft shadow, then the grid
  const mn = crateMin(), ext = result.design.layout.external, cx = mn[0] + ext[0] / 2, cy = mn[1] + ext[1] / 2, zG = mn[2] - 1;
  const soft = 900, sm = [mn[0] - soft, mn[1] - soft, zG], ss = [ext[0] + 2 * soft, ext[1] + 2 * soft, 1];
  gl.useProgram(shadowProg.p); gl.uniformMatrix4fv(shadowProg.u.uVP, false, vp); gl.uniformMatrix4fv(shadowProg.u.uModel, false, boxModel(sm, ss));
  gl.uniform2f(shadowProg.u.uC, cx, cy); gl.uniform2f(shadowProg.u.uHalf, ext[0] / 2, ext[1] / 2); gl.uniform1f(shadowProg.u.uSoft, soft);
  gl.bindBuffer(gl.ARRAY_BUFFER, cube.quad); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
  useLines(vp);
  const step = gridStep(), R = Math.max(4000, Math.max(ext[0], ext[1]) * 2.2), g = [];
  const gx0 = Math.ceil((cx - R) / step) * step, gy0 = Math.ceil((cy - R) / step) * step;
  for (let x = gx0; x <= cx + R; x += step) g.push(x, cy - R, zG, x, cy + R, zG);
  for (let y = gy0; y <= cy + R; y += step) g.push(cx - R, y, zG, cx + R, y, zG);
  gl.uniform3f(lineProg.u.uFade, cx, cy, R); drawLineList(g, [0.62, 0.70, 0.78, 0.26]); gl.uniform3f(lineProg.u.uFade, 0, 0, 0);

  // boards that are fading in or out between closed, open and exploded
  const fading = objs.filter(o => !o.ghost && o.alpha <= 0.99);
  if (fading.length) {
    useMesh(vp, b.eye); for (const o of fading) drawBox(boxModel(o.min, o.size), COLORS[o.m.kind], o.alpha);
    useLines(vp); for (const o of fading) drawEdges(boxModel(o.min, o.size), [0.16, 0.10, 0.04, 0.55 * o.alpha]);
  }
  // everything that is not the selected boards, drawn faint
  const ghosts = objs.filter(o => o.ghost);
  if (ghosts.length) {
    useMesh(vp, b.eye);
    for (const o of ghosts) {
      if (o.type === 'box') drawBox(boxModel(o.min, o.size), COLORS[o.m.kind], 0.07);
      else drawPart(o.mesh, partModel(o.mesh, o.R, o.center), o.R, [1, 1, 1], 0.10);
    }
    useLines(vp);
    for (const o of ghosts) if (o.type === 'box') drawEdges(boxModel(o.min, o.size), [0.85, 0.80, 0.70, 0.13]);
  }

  // dimension lines
  const D = dimLines();
  if (D) { useLines(vp); gl.disable(gl.DEPTH_TEST); drawLineList(D.pts, [0.90, 0.92, 0.95, 0.6]); if (D.inner.length) drawLineList(D.inner, [0.50, 0.82, 1.0, 0.95]); gl.enable(gl.DEPTH_TEST); }
  gl.depthMask(true); gl.disable(gl.BLEND);
  placeLabels(D, vp);
}

function dimLines() {
  if (!state.view.dims) return null;
  const mn = crateMin(), ext = result.design.layout.external, mx = V.add(mn, ext);
  const off = 110 + Math.max(ext[0], ext[1], ext[2]) * 0.05 + 320 * state.view.explode, t = 40 + Math.max(ext[0], ext[1], ext[2]) * 0.0125, z = mn[2];
  const pts = [], seg = (a, b) => pts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  const La = [mn[0], mn[1] - off, z], Lb = [mx[0], mn[1] - off, z];
  seg(La, Lb); seg([mn[0], mn[1], z], [mn[0], mn[1] - off - t, z]); seg([mx[0], mn[1], z], [mx[0], mn[1] - off - t, z]);
  const Wa = [mx[0] + off, mn[1], z], Wb = [mx[0] + off, mx[1], z];
  seg(Wa, Wb); seg([mx[0], mn[1], z], [mx[0] + off + t, mn[1], z]); seg([mx[0], mx[1], z], [mx[0] + off + t, mx[1], z]);
  const Ha = [mx[0] + off, mx[1], z], Hb = [mx[0] + off, mx[1], mx[2]];
  seg(Ha, Hb); seg([mx[0], mx[1], mx[2]], [mx[0] + off + t, mx[1], mx[2]]);
  const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
  const labels = [[mid(La, Lb), ext[0]], [mid(Wa, Wb), ext[1]], [mid(Ha, Hb), ext[2]]], inner = [];
  // One part, measured along the edges of its outer box, once the inside is on show.
  const v = state.view, L = result.design.layout;
  if (v.parts && (v.lidA < 0.5 || v.explode > 0.5)) {
    const top = Math.max(...L.slots.map(s => s.index[2])), row = L.slots.filter(s => s.index[2] === top && s.index[1] === 0);
    const s0 = row.reduce((a, b) => (b.index[0] > a.index[0] ? b : a)), c = L.cellSize, p = s0.min, q = [p[0] + c[0], p[1] + c[1], p[2] + c[2]];
    const e = (a, b, val) => { inner.push(a[0], a[1], a[2], b[0], b[1], b[2]); labels.push([mid(a, b), val, true]); };
    e([p[0], p[1], q[2]], [q[0], p[1], q[2]], c[0]); e([q[0], p[1], q[2]], [q[0], q[1], q[2]], c[1]); e([q[0], p[1], p[2]], [q[0], p[1], q[2]], c[2]);
  }
  return { pts, inner, labels };
}
const dimEls = [0, 1, 2, 3, 4, 5].map(() => { const d = document.createElement('div'); d.className = 'dim'; d.style.display = 'none'; $('#dims').appendChild(d); return d; });
function project(p, vp) {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13], w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  if (w <= 0) return null;
  return [(x / w * 0.5 + 0.5) * canvas.clientWidth, (1 - (y / w * 0.5 + 0.5)) * canvas.clientHeight];
}
function placeLabels(D, vp) {
  dimEls.forEach((el, i) => {
    const s = D && D.labels[i] && project(D.labels[i][0], vp);
    if (!s) { el.style.display = 'none'; return; }
    el.style.display = 'block'; el.style.left = s[0] + 'px'; el.style.top = s[1] + 'px';
    el.textContent = len(D.labels[i][1]) + ' ' + unit(); el.classList.toggle('inner', !!D.labels[i][2]);
  });
}

/* ================= Picking ================= */
function pick(clientX, clientY) {
  const r = canvas.getBoundingClientRect(), fa = freeArea(), nx = (clientX - r.left) / r.width * 2 - 1 - fa.sx, ny = 1 - (clientY - r.top) / r.height * 2 - fa.sy;
  const b = camBasis(cam), th = Math.tan(FOV / 2), aspect = r.width / r.height;
  const dir = V.norm(V.add(V.add(V.mul(b.z, -1), V.mul(b.x, nx * th * aspect)), V.mul(b.y, ny * th)));
  const o = b.eye; let best = null, bestT = Infinity;
  const slab = (min, size) => {
    let t0 = 0, t1 = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dir[i]) < 1e-9) { if (o[i] < min[i] || o[i] > min[i] + size[i]) return null; continue; }
      let a = (min[i] - o[i]) / dir[i], c = (min[i] + size[i] - o[i]) / dir[i]; if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) return null;
    }
    return t0;
  };
  for (const ob of sceneObjects()) {
    if (ob.alpha < 0.5) continue;
    let t = slab(ob.min, ob.size); if (t === null || t >= bestT) continue;
    if (ob.type === 'part') {
      const R = ob.R, mc = ob.mesh.center, rel = V.sub(o, ob.center);
      const lo = [0, 1, 2].map(j => (R[j] * rel[0] + R[3 + j] * rel[1] + R[6 + j] * rel[2]) / 1000 + mc[j]);
      const ld = [0, 1, 2].map(j => (R[j] * dir[0] + R[3 + j] * dir[1] + R[6 + j] * dir[2]) / 1000);
      const P = ob.mesh.pos; t = Infinity;
      for (let i = 0; i < P.length; i += 9) {
        const a = [P[i], P[i + 1], P[i + 2]], e1 = [P[i + 3] - a[0], P[i + 4] - a[1], P[i + 5] - a[2]], e2 = [P[i + 6] - a[0], P[i + 7] - a[1], P[i + 8] - a[2]];
        const pv = V.cross(ld, e2), det = V.dot(e1, pv); if (Math.abs(det) < 1e-18) continue;
        const tv = V.sub(lo, a), u = V.dot(tv, pv) / det; if (u < 0 || u > 1) continue;
        const qv = V.cross(tv, e1), v = V.dot(ld, qv) / det; if (v < 0 || u + v > 1) continue;
        const tt = V.dot(e2, qv) / det; if (tt > 0 && tt < t) t = tt;
      }
      if (t >= bestT) continue;
    }
    bestT = t; best = ob;
  }
  return best;
}

/* ================= Pointer input ================= */
const ptrs = new Map(); let drag = null;
const tip = $('#tip');
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  drag = { moved: 0, pan: e.button !== 0 || e.shiftKey }; cam.goal = null; canvas.classList.add('dragging'); tip.style.display = 'none';
});
canvas.addEventListener('pointermove', (e) => {
  const prev = ptrs.get(e.pointerId);
  if (!prev) { hoverAt(e); return; }
  const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (drag) drag.moved += Math.abs(dx) + Math.abs(dy);
  if (ptrs.size === 2) {
    const other = [...ptrs.entries()].find(([id]) => id !== e.pointerId)[1];
    const d0 = Math.hypot(prev[0] - other[0], prev[1] - other[1]), d1 = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
    if (d0 > 0 && d1 > 0) cam.d *= d0 / d1;
    panBy(dx / 2, dy / 2);
  } else if (drag && drag.pan) panBy(dx, dy);
  else if (drag && drag.moved >= 5) { cam.az -= dx * 0.008; cam.el = Math.max(-0.2, Math.min(Math.PI / 2 - 0.002, cam.el + dy * 0.008)); setCamView(null); }
  dirty = true;
});
const endPtr = (e) => {
  if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
  if (ptrs.size === 0) { canvas.classList.remove('dragging'); if (drag && drag.moved < 5 && e.type === 'pointerup') clickAt(e); drag = null; }
};
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('pointerleave', () => { if (state.hover && state.hover.source === '3d') setHover(null); tip.style.display = 'none'; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.goal = null; cam.d = Math.max(300, Math.min(60000, cam.d * Math.exp(e.deltaY * 0.0012))); dirty = true; }, { passive: false });
function panBy(dx, dy) {
  const b = camBasis(cam), k = 2 * cam.d * Math.tan(FOV / 2) / Math.max(1, canvas.clientHeight);
  cam.t = V.add(cam.t, V.add(V.mul(b.x, -dx * k), V.mul(b.y, dy * k)));
}
function hoverAt(e) {
  const o = pick(e.clientX, e.clientY);
  if (!o) { tip.style.display = 'none'; setHover(null); return; }
  let html;
  if (o.type === 'part') { const p = part(); html = `<b>${esc(p.name)}</b><span>Part ${o.i + 1} of ${state.quantity}. ${esc(p.material)}, ${wt(p.mass_kg)}</span>`; setHover(null); }
  else {
    const row = result.design.bom.find(r => r.key === o.m.bomKey);
    html = `<b>${esc(row.label)}</b><span>${esc(stockText(row))}, cut ${cutText(row)}${imp() ? '' : ' mm'}. ${row.qty} in this crate</span>`;
    setHover({ key: row.key, source: '3d' });
  }
  const r = stage.getBoundingClientRect();
  tip.innerHTML = html; tip.style.display = 'block';
  tip.style.left = Math.max(4, Math.min(e.clientX - r.left + 14, r.width - 250)) + 'px'; tip.style.top = (e.clientY - r.top + 16) + 'px';
}
function clickAt(e) {
  const o = pick(e.clientX, e.clientY);
  if (o && o.type === 'box') {
    setPin(o.m.bomKey === state.pin ? null : o.m.bomKey);
    if (state.pin) { setTab('cut'); const r = $('#p-cut .row.pin'); if (r) r.scrollIntoView({ block: 'nearest' }); }
  } else setPin(null);
}
function setHover(h) {
  const a = state.hover, same = (!a && !h) || (a && h && a.key === h.key && a.asm === h.asm && a.source === h.source);
  if (same) return;
  state.hover = h; syncRows(); dirty = true;
}
function setPin(key) {
  state.pin = key; syncRows(); dirty = true;
  const row = key && result.design.bom.find(r => r.key === key);
  $('#pinbar').classList.toggle('on', !!row);
  if (row) $('#pintext').textContent = `Showing ${row.qty} × ${row.label.toLowerCase()}`;
}
function syncRows() {
  const hk = state.hover && state.hover.key;
  $$('#p-cut .row').forEach(r => { r.classList.toggle('hl', r.dataset.k === hk); r.classList.toggle('pin', r.dataset.k === state.pin); });
}
$('#unpin').onclick = () => setPin(null);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.pin) setPin(null); });

/* ================= Panels ================= */
const stockText = (r) => r.material === 'plywood' ? (imp() ? frac(r.thick) + ' plywood' : r.thick + ' mm plywood') : (imp() ? frac(r.section[0]) + ' × ' + frac(r.section[1]) : r.section[0] + ' × ' + r.section[1]) + ' lumber';
const cutText = (r) => r.cut.map(cutLen).join(' × ');
const ASM = { base: 'Base', sides: 'Side walls', ends: 'End walls', lid: 'Lid', inside: 'Inside the crate' };
const DENSITY = { plywood: 600, lumber: 480 };
const shortName = (p) => { const w = p.name.split(' ').slice(-2).join(' '); return w.charAt(0).toUpperCase() + w.slice(1); };
const layoutName = (l) => describe(l) + (l.orientation.id === 'as-modeled' ? '' : ', ' + l.orientation.label.toLowerCase());

function renderPart() {
  const p = part(), m = MESH[p.id];
  if (document.activeElement && document.activeElement.id === 'massIn') return;
  const measured = dims(m.sizeMm) + ' ' + unit();
  const match = p.custom ? null : m.sizeMm.every((v, i) => Math.abs(v - p.dimensions_mm[i]) <= 1);
  $('#partName').textContent = p.name;
  const mass = p.custom ? `<input id="massIn" type="number" min="0.01" step="0.1" value="${p.mass_kg}" aria-label="Mass of one part in kilograms"> kg each` : (imp() ? wt(p.mass_kg) : p.mass_kg + ' kg') + ' each';
  const model = match === null ? (m.inMm ? 'file read as millimetres' : 'size measured from the file') : match ? 'model matches catalog' : 'model does not match catalog';
  $('#partMeta').innerHTML = `<div><b>${esc(p.id)}</b> · ${p.material ? esc(p.material) : 'material not given'} · ${mass}</div>
    <div>${measured} · <span class="${match === false ? 'warn' : ''}">${model}</span></div>` +
    (p.massAssumed ? `<div class="warn">No mass in the file. 10 kg is a stand-in, so enter the real one.</div>` : '');
  const mi = $('#massIn');
  if (mi) mi.oninput = () => { const v = +mi.value; if (v > 0) { p.mass_kg = v; p.massAssumed = false; Object.assign(state, { layoutKey: null }); update(); } };
}

function renderOverview() {
  const d = result.design, L = d.layout, c = d.construction, p = part(), n = state.quantity;
  const count = (k) => d.members.filter(m => m.kind === k).length;
  const posts = count('blocking'), bearers = count('bearer'), seps = count('separator');
  const mass = {}; let maxMass = 0;
  for (const m of d.members) mass[m.asm] = (mass[m.asm] || 0) + m.size[0] * m.size[1] * m.size[2] / 1e9 * DENSITY[m.material];
  for (const k in mass) maxMass = Math.max(maxMass, mass[k]);
  const row = (name, val, sub, end) => `<li${end ? ' class="end"' : ''}><b>${name}</b><span class="v">${val}</span><small>${sub}</small></li>`;
  const sk = imp() ? frac(c.skid.wide) + ' × ' + frac(c.skid.tall) : c.skid.wide + ' × ' + c.skid.tall;
  $('#p-overview').innerHTML = `<h2>Crate for ${n} × ${esc(p.name.toLowerCase())}</h2>
    <div class="big">${dims(L.external)}<small>${unit()}</small></div>
    <div class="line">Outside, length × width × height</div>
    <div class="line"><span class="mono dimtext">${dimsOther(L.external)}</span></div>
    <div class="line">Ships at <span class="mono">${vol(L.externalVolumeM3)}</span>, gross <span class="mono">${wt(d.grossKg)}</span></div>
    <ul class="chain">
      ${row('Parts', wt(d.payloadKg), `${n} × ${imp() ? wt(p.mass_kg) : p.mass_kg + ' kg'}, ${esc(p.material)}`)}
      ${row('Layout', L.counts.join(' × '), `${layoutName(L)}. Inside is ${dims(L.interior)} ${unit()}`)}
      ${row('Walls and lid', imp() ? frac(c.panelMm) + ' ply' : c.panelMm + ' mm ply', `${state.panelThickness === 'auto' ? 'Sized for the load' : 'Set by hand'}, stiffened with ${imp() ? '3/4″ × 3 1/2″' : '19 × 89'} cleats`)}
      ${row('Base', c.skidCount + ' skids', `${sk} skids under a ${imp() ? frac(c.floorMm) : c.floorMm + ' mm'} floor, open for forklift tines`)}
      ${row('Blocking', posts + ' posts', `${bearers} bearer${bearers === 1 ? '' : 's'} underneath${seps ? ', ' + seps + ' layer separator' + (seps === 1 ? '' : 's') : ''}`)}
      ${row('Gross weight', wt(d.grossKg), `empty crate ${wt(d.tareKg)}, ~${d.screws} screws, about $${Math.round(d.materialCostUsd)} of wood`, true)}
    </ul>
    <h3>Crate weight by assembly</h3>
    <div class="bars">${Object.keys(ASM).filter(k => mass[k]).map(k => `<div class="barrow" data-asm="${k}" tabindex="0"><span>${ASM[k]}</span><span class="v">${wt(mass[k])}</span><span class="track"><i style="width:${Math.max(2, mass[k] / maxMass * 100).toFixed(0)}%"></i></span></div>`).join('')}</div>`;
  $$('#p-overview .barrow').forEach(r => {
    r.onmouseenter = r.onfocus = () => setHover({ asm: r.dataset.asm, source: 'list' });
    r.onmouseleave = r.onblur = () => setHover(null);
  });
}

function thumb(l) {
  const c = result.design.construction, wall = c.panelMm + Domain.CT, base = c.floorMm + c.skid.tall;
  const EL = l.external[0], EW = l.external[1], EH = l.external[2], a = l.cellSize[0], b = l.cellSize[1], h = l.cellSize[2], gap = 140;
  const s = Math.min(104 / EL, 84 / (EW + EH + gap)), W = EL * s, H = (EW + EH + gap) * s, f = (v) => (v * s).toFixed(1);
  let o = `<svg width="${Math.ceil(W)}" height="${Math.ceil(H)}" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" aria-hidden="true">`;
  o += `<rect x=".5" y=".5" width="${(W - 1).toFixed(1)}" height="${(EW * s - 1).toFixed(1)}" fill="#C9B48C" stroke="#E6D6B4"/>`;
  for (const sl of l.slots) if (sl.index[2] === 0) o += `<rect x="${f(wall + sl.min[0])}" y="${f(wall + sl.min[1])}" width="${f(a)}" height="${f(b)}" fill="#59636E"/>`;
  const y0 = (EW + gap) * s;
  o += `<rect x=".5" y="${(y0 + 0.5).toFixed(1)}" width="${(W - 1).toFixed(1)}" height="${(EH * s - 1).toFixed(1)}" fill="#C9B48C" stroke="#E6D6B4"/>`;
  o += `<rect x=".5" y="${(y0 + (EH - base) * s).toFixed(1)}" width="${(W - 1).toFixed(1)}" height="${(base * s - 0.5).toFixed(1)}" fill="#96703F"/>`;
  for (const sl of l.slots) if (sl.index[1] === 0) o += `<rect x="${f(wall + sl.min[0])}" y="${(y0 + (EH - base - sl.min[2] - h) * s).toFixed(1)}" width="${f(a)}" height="${f(h)}" fill="#59636E"/>`;
  return o + '</svg>';
}
function renderLayout() {
  const { layouts, design, isBest } = result, cur = design.layout, best = layouts[0], next = layouts[1];
  let why;
  if (layouts.length === 1) why = 'This is the only way to pack this batch under the current packing rules.';
  else if (isBest) {
    const pct = Math.round((next.externalVolumeM3 / best.externalVolumeM3 - 1) * 100);
    why = !next.stable && best.stable ? 'The recommended layout is the smallest crate that will not tip easily.'
      : pct >= 3 ? `The recommended layout is the smallest stable crate. The next option ships ${pct}% more volume.`
      : 'The recommended layout is the lowest of the options that tie on shipping volume.';
  } else {
    const pct = Math.round((cur.externalVolumeM3 / best.externalVolumeM3 - 1) * 100);
    why = `Your pick ships ${pct > 0 ? pct + '% more volume than' : 'about the same volume as'} the recommended layout. <button type="button" class="linkbtn" id="useBest">Use the recommended layout</button>`;
  }
  const shown = state.showAll ? layouts.slice() : layouts.slice(0, 4);
  if (!shown.includes(cur)) shown.push(cur);
  const maxVol = Math.max(...shown.map(l => l.externalVolumeM3));
  $('#p-layout').innerHTML = `<h2>Ways to pack it</h2><p>${why} Each drawing shows the crate from above, then from the side.</p>` +
    shown.map(l => `<button type="button" class="opt" data-k="${esc(l.key)}" aria-pressed="${l === cur}">
      ${thumb(l)}
      <span><span class="opt-title">${describe(l)}${l === best ? '<span class="badge">recommended</span>' : ''}${l.stable ? '' : '<span class="badge tall">may tip</span>'}</span>
      <span class="opt-dims">${dims(l.external)} ${unit()}</span>
      <span class="opt-meta">${esc(l.orientation.label)}, ${vol(l.externalVolumeM3)}</span>
      <span class="volbar"><i style="width:${(l.externalVolumeM3 / maxVol * 100).toFixed(0)}%"></i></span></span>
    </button>`).join('') +
    (layouts.length > 4 ? `<button type="button" class="more" id="moreBtn">${state.showAll ? 'Show fewer' : 'Show all ' + layouts.length + ' layouts'}</button>` : '');
  $$('#p-layout .opt').forEach(b => b.onclick = () => { state.layoutKey = b.dataset.k === best.key ? null : b.dataset.k; update(); });
  const ub = $('#useBest'); if (ub) ub.onclick = () => { state.layoutKey = null; update(); };
  const mb = $('#moreBtn'); if (mb) mb.onclick = () => { state.showAll = !state.showAll; renderLayout(); };
}

function renderCut() {
  const d = result.design; let rows = '';
  for (const asm of Object.keys(ASM)) {
    const items = d.bom.filter(r => r.asm === asm); if (!items.length) continue;
    rows += `<tr class="grp"><td colspan="4">${ASM[asm]}</td></tr>` + items.map(r =>
      `<tr class="row" data-k="${esc(r.key)}" tabindex="0"><td>${esc(r.label)}</td><td>${esc(stockText(r))}</td><td>${cutText(r)}</td><td>${r.qty}</td></tr>`).join('');
  }
  $('#p-cut').innerHTML = `<h2>Cut list</h2><p>Point at a row to see where those boards go. Click it to keep them lit.</p>
    <table class="cut"><thead><tr><th>Piece</th><th>Stock</th><th>Cut, ${unit()}</th><th>Qty</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals"><div><b>${imp() ? (d.plywoodM2 * 10.7639).toFixed(0) + ' ft²' : d.plywoodM2.toFixed(1) + ' m²'}</b>plywood</div>
      <div><b>${imp() ? (d.lumberM * 3.28084).toFixed(0) + ' ft' : d.lumberM.toFixed(1) + ' m'}</b>lumber</div><div><b>~${d.screws}</b>wood screws</div></div>
    <div class="actions"><button type="button" class="btn" id="csvBtn">Download cut list</button><button type="button" class="btn" id="copyBtn">Copy cut list</button><span id="csvMsg" role="status"></span></div>`;
  $$('#p-cut .row').forEach(r => {
    const k = r.dataset.k;
    r.onmouseenter = () => setHover({ key: k, source: 'list' }); r.onmouseleave = () => setHover(null);
    r.onfocus = r.onmouseenter; r.onblur = r.onmouseleave;
    r.onclick = () => setPin(state.pin === k ? null : k);
    r.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.onclick(); } };
  });
  $('#csvBtn').onclick = () => {
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv()], { type: 'text/csv' })); a.download = `crate-${state.partId}-x${state.quantity}.csv`; document.body.appendChild(a); a.click(); a.remove(); $('#csvMsg').textContent = 'Cut list downloaded.'; }
    catch (err) { $('#csvMsg').textContent = 'Download is blocked in this view. Use Copy cut list.'; }
  };
  $('#copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(csv()); $('#csvMsg').textContent = 'Cut list copied.'; } catch (err) { $('#csvMsg').textContent = 'Copy is blocked in this view.'; }
  };
  syncRows();
}
function csv() {
  const d = result.design, L = d.layout, p = part(), q = (s) => /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  return [`# Crate for ${state.quantity} x ${p.id} ${p.name}`, `# External ${L.external.map(Math.round).join(' x ')} mm, gross ${Math.round(d.grossKg)} kg`,
    `# Layout ${L.counts.join(' x ')}, ${L.orientation.label}`, 'component,material,stock,cut_mm,qty',
    ...d.bom.map(r => [q(ASM[r.asm] + ': ' + r.label), r.material, q(r.stock), r.cut.join(' x '), r.qty].join(',')), `Wood screws (approx),fastener,,,${d.screws}`].join('\n') + '\n';
}

function renderChecks() {
  const d = result.design, p = part(), m = MESH[p.id], rank = { caution: 0, ok: 1, info: 2 };
  const match = m.sizeMm.every((v, i) => Math.abs(v - p.dimensions_mm[i]) <= 1);
  const measured = m.sizeMm.map(v => Math.round(v)).join(' × ');
  const all = d.checks.concat([p.custom
    ? { level: 'info', title: 'Size comes from the model file', detail: `Measured ${measured} mm${m.inMm ? ', reading the file as millimetres' : ''}. The model is assumed to have Z pointing up.` }
    : match ? { level: 'ok', title: '3D model matches the catalog size', detail: `Measured ${measured} mm from the model file.` }
    : { level: 'caution', title: '3D model does not match the catalog', detail: `The model measures ${measured} mm. The catalog says ${p.dimensions_mm.join(' × ')} mm.` }]);
  if (p.massAssumed) all.push({ level: 'caution', title: 'Part mass is a stand-in', detail: 'Enter the real mass under the part view. Weights and plywood thickness depend on it.' });
  all.sort((x, y) => rank[x.level] - rank[y.level]);
  $('#p-checks').innerHTML = `<h2>Checks</h2><p>Rules of thumb for a first pass. Heavy or unusual loads still need an engineering review.</p>` +
    all.map(c => `<div class="check ${c.level}"><i></i><div><b>${esc(c.title)}</b><span>${esc(c.detail)}</span></div></div>`).join('');
  const n = all.filter(c => c.level === 'caution').length, badge = $('#checkCount');
  badge.hidden = !n; badge.textContent = n;
}

function syncControls() {
  const p = part();
  $$('#units button').forEach(b => b.setAttribute('aria-pressed', b.dataset.u === state.units));
  if (document.activeElement !== $('#qty')) $('#qty').value = state.quantity;
  $('#qtyChips').innerHTML = p.suggested_quantities.map(n => `<button type="button" class="chip" aria-pressed="${n === state.quantity}" data-n="${n}">${n}</button>`).join('');
  $$('#qtyChips .chip').forEach(b => b.onclick = () => setRule({ quantity: +b.dataset.n }));
  $('#r-upright').checked = state.keepUpright;
  $$('#r-layers button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.n === state.maxLayers));
  $$('#r-panel button').forEach(b => b.setAttribute('aria-pressed', b.dataset.n === String(state.panelThickness)));
  $('#r-gap').value = state.partGapMm; $('#r-clr').value = state.wallClearanceMm;
  $('#o-gap').textContent = len(state.partGapMm) + ' ' + unit(); $('#o-clr').textContent = len(state.wallClearanceMm) + ' ' + unit();
  const c = result.design.construction;
  $('#n-panel').textContent = state.panelThickness === 'auto' ? `Auto picked ${c.panelMm} mm for ${wt(result.design.payloadKg)} of parts. The floor is always 19 mm.` : 'Thickness in mm. The floor is always 19 mm.';
  $('#gridnote').textContent = imp() ? '1 ft' : '500 mm';
  syncView();
}
function syncView() {
  const v = state.view, e = explodeGoal === null ? v.explode : explodeGoal;
  $$('#dock input[type=checkbox]').forEach(i => { i.checked = v[i.dataset.v]; });
  $('#explode').value = Math.round(e * 100);
  const mode = currentMode(), mb = $('#modeBtn'), nxt = MODES[(MODES.indexOf(mode) + 1) % 3];
  mb.innerHTML = MODE_ICON[mode || 'custom'];
  mb.setAttribute('aria-label', (mode ? MODE_NAME[mode] + ' view' : 'Custom view') + '. Switch to ' + MODE_NAME[nxt].toLowerCase() + '.');
  mb.title = (mode ? MODE_NAME[mode] : 'Custom view') + '. Click for ' + MODE_NAME[nxt].toLowerCase() + '.';
}
const MODES = ['closed', 'open', 'exploded'], MODE_NAME = { closed: 'Closed', open: 'Open', exploded: 'Exploded' };
const svg = (d) => `<svg viewBox="0 0 32 32" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${d}</svg>`;
const MODE_ICON = {
  closed: svg('<path d="M16 5 27 10.5v11L16 27 5 21.5v-11z"/><path d="M5 10.5 16 16l11-5.5M16 16v11"/>'),
  open: svg('<path d="M5 14v8.5L16 28l11-5.500V14"/><path d="M5 14l11 5.5L27 14M16 19.500V28"/><path d="M5 14l11-5.500L27 14" opacity=".55"/><path d="M8 6.500 16 2.500l8 4-8 4z"/>'),
  exploded: svg('<path d="M10 17v6l6 3 6-3v-6"/><path d="M10 17l6 3 6-3M16 20v6"/><path d="M10 6.500l6-3 6 3-6 3z"/><path d="M4 15v7M28 15v7"/><path d="M16 11.500v3M6.500 18.500H8M24 18.500h1.500" opacity=".55"/>'),
  custom: svg('<path d="M16 5 27 10.5v11L16 27 5 21.5v-11z" stroke-dasharray="3 3"/><path d="M5 10.5 16 16l11-5.5M16 16v11" opacity=".55"/>'),
};
function currentMode() {
  const v = state.view, e = explodeGoal === null ? v.explode : explodeGoal;
  return e === 0 && v.lid && v.front ? 'closed' : e === 0 && !v.lid && !v.front ? 'open' : e === 1 && v.lid && v.front ? 'exploded' : null;
}
function applyMode(p) {
  const v = state.view;
  v.lid = v.front = p !== 'open'; explodeGoal = p === 'exploded' ? 1 : 0;
  if (reduceMotion) { v.explode = explodeGoal; explodeGoal = null; v.lidA = v.frontA = v.lid ? 1 : 0; }
  syncView(); goTo(fitGoal(camView || undefined, p === 'exploded' ? 1 : 0)); dirty = true;
}
function setCamView(name) { camView = name; $$('#cams button').forEach(b => b.setAttribute('aria-pressed', b.dataset.c === name)); }
function setTab(t) {
  state.tab = t;
  $$('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t));
  for (const id of ['overview', 'layout', 'cut', 'rules', 'checks']) $('#p-' + id).hidden = id !== t;
}

function update() {
  result = Domain.computeDesign(part(), state, state.layoutKey);
  if (state.pin && !result.design.bom.some(r => r.key === state.pin)) setPin(null);
  state.hover = null;
  renderPart(); renderOverview(); renderLayout(); renderCut(); renderChecks(); syncControls();
  const key = state.partId + result.design.layout.external.join(',');
  if (key !== lastExtKey) { goTo(fitGoal(camView || undefined, explodeGoal === null ? state.view.explode : explodeGoal), !lastExtKey); lastExtKey = key; }
  dirty = true;
}
function setRule(patch) {
  if (patch.quantity !== undefined) patch.quantity = Math.max(1, Math.min(200, Math.round(patch.quantity) || 1));
  Object.assign(state, patch, { layoutKey: null, showAll: false }); update();
}

/* ================= Wiring ================= */
$$('#units button').forEach(b => b.onclick = () => { state.units = b.dataset.u; update(); });

/* Loading a part: the catalog supplies mass and material when the file name is one it knows. */
function setPart(meta, mesh, quantity) {
  upload(mesh); MESH[meta.id] = mesh; current = meta; state.partId = meta.id;
  state.pin = null; $('#pinbar').classList.remove('on');
  Object.assign(pv, { az: -0.9, el: 0.42, zoom: 1, auto: !reduceMotion, dirty: true });
  if (document.activeElement && document.activeElement.id === 'massIn') document.activeElement.blur();
  setRule({ quantity: quantity || meta.suggested_quantities[0] });
}
const loadMsg = (t) => { $('#loadMsg').textContent = t || ''; };
async function loadFiles(list) {
  const files = [...list]; loadMsg('');
  try {
    let details = false;
    for (const f of files.filter(f => /\.json$/i.test(f.name))) {
      const j = JSON.parse(await f.text());
      for (const p of (j.parts || [])) { if (!p.model || !(p.mass_kg > 0)) continue; const i = PARTS.findIndex(x => x.model === p.model); if (i >= 0) PARTS[i] = p; else PARTS.push(p); details = true; }
    }
    const g = files.find(f => /\.glb$/i.test(f.name));
    if (!g) { loadMsg(details ? 'Part details loaded. Now add the .glb file.' : files.some(f => /\.gltf$/i.test(f.name)) ? 'Text .gltf files are not supported. Export the part as a single .glb file.' : 'Choose a .glb file.'); return; }
    const mesh = parseGlb(new Uint8Array(await g.arrayBuffer())), known = PARTS.find(p => p.model === g.name), stem = g.name.replace(/\.glb$/i, '');
    const name = stem.replace(/^PART-\d+-/i, '').replace(/[-_]+/g, ' ').trim() || stem;
    setPart(known ? { suggested_quantities: [1, 4, 8], ...known } : {
      id: stem, name: name.charAt(0).toUpperCase() + name.slice(1), model: g.name, material: null, mass_kg: 10, massAssumed: true, custom: true,
      dimensions_mm: mesh.sizeMm, suggested_quantities: [1, 4, 8] }, mesh);
  } catch (err) { loadMsg(err.message || 'That file could not be read.'); }
}
$('#loadBtn').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = (e) => { loadFiles(e.target.files); e.target.value = ''; };
let dragDepth = 0; const veil = $('#dropveil');
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; veil.classList.add('on'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) veil.classList.remove('on'); });
window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; veil.classList.remove('on'); if (e.dataTransfer && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files); });

/* The part on its own: turns slowly until someone takes hold of it. */
const pcan = $('#partCanvas'), pctx = pcan.getContext('2d');
const pv = { az: -0.9, el: 0.42, zoom: 1, auto: !reduceMotion, dirty: true, last: 0, ptr: null };
function drawPartView() {
  const dpr = Math.min(2, window.devicePixelRatio || 1), cw = pcan.clientWidth, ch = pcan.clientHeight, m = MESH[state.partId];
  if (!cw || !ch || !m) return false;
  const pw = Math.min(canvas.width, Math.round(cw * dpr)), ph = Math.min(canvas.height, Math.round(ch * dpr));
  if (pcan.width !== pw || pcan.height !== ph) { pcan.width = pw; pcan.height = ph; }
  const r = Math.hypot(m.sizeMm[0], m.sizeMm[1], m.sizeMm[2]) / 2, th = Math.tan(FOV / 2);
  const c = { t: [0, 0, 0], az: pv.az, el: pv.el, d: r / Math.sin(Math.min(FOV / 2, Math.atan(th * pw / ph))) * 1.04 * pv.zoom };
  const b = camBasis(c), vp = mul4(perspective(FOV, pw / ph, c.d * 0.05, c.d * 12), lookAt(b.eye, b.x, b.y, b.z));
  gl.viewport(0, 0, pw, ph); gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, pw, ph);
  gl.clearColor(0, 0, 0, 0); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  useMesh(vp, b.eye); drawPart(m, partModel(m, ID3, [0, 0, 0]), ID3, [1.12, 1.12, 1.12], 1);
  gl.disable(gl.SCISSOR_TEST);
  pctx.clearRect(0, 0, pw, ph); pctx.drawImage(canvas, 0, canvas.height - ph, pw, ph, 0, 0, pw, ph);
  return true;
}
pcan.addEventListener('pointerdown', (e) => { try { pcan.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } pv.auto = false; pv.ptr = [e.clientX, e.clientY]; pcan.classList.add('dragging'); });
pcan.addEventListener('pointermove', (e) => {
  if (!pv.ptr) return;
  pv.az -= (e.clientX - pv.ptr[0]) * 0.01; pv.el = Math.max(-1.45, Math.min(1.5, pv.el + (e.clientY - pv.ptr[1]) * 0.01));
  pv.ptr = [e.clientX, e.clientY]; pv.dirty = true;
});
const pvEnd = () => { pv.ptr = null; pcan.classList.remove('dragging'); };
pcan.addEventListener('pointerup', pvEnd); pcan.addEventListener('pointercancel', pvEnd);
pcan.addEventListener('wheel', (e) => { e.preventDefault(); pv.auto = false; pv.zoom = Math.max(0.35, Math.min(3, pv.zoom * Math.exp(e.deltaY * 0.0012))); pv.dirty = true; }, { passive: false });
pcan.addEventListener('dblclick', () => { Object.assign(pv, { el: 0.42, zoom: 1, auto: !reduceMotion, dirty: true }); });

$('#qty').addEventListener('input', (e) => { if (e.target.value !== '') setRule({ quantity: +e.target.value }); });
$('#qty').addEventListener('blur', (e) => { e.target.value = state.quantity; });
$('#qtyDown').onclick = () => setRule({ quantity: state.quantity - 1 });
$('#qtyUp').onclick = () => setRule({ quantity: state.quantity + 1 });
$('#r-upright').onchange = (e) => setRule({ keepUpright: e.target.checked });
$$('#r-layers button').forEach(b => b.onclick = () => setRule({ maxLayers: +b.dataset.n }));
$$('#r-panel button').forEach(b => b.onclick = () => setRule({ panelThickness: b.dataset.n === 'auto' ? 'auto' : +b.dataset.n }));
$('#r-gap').oninput = (e) => setRule({ partGapMm: +e.target.value });
$('#r-clr').oninput = (e) => setRule({ wallClearanceMm: +e.target.value });
$('#r-reset').onclick = () => setRule({ ...DEFAULT_RULES });
$$('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));
$$('#dock input[type=checkbox]').forEach(i => i.onchange = () => { state.view[i.dataset.v] = i.checked; syncView(); if (i.dataset.v === 'dims') goTo(fitGoal(camView || undefined, state.view.explode)); dirty = true; });
$('#explode').oninput = (e) => { explodeGoal = null; state.view.explode = e.target.value / 100; syncView(); dirty = true; };
$('#explode').onchange = () => goTo(fitGoal(camView || undefined, state.view.explode));
$('#modeBtn').onclick = () => applyMode(MODES[(MODES.indexOf(currentMode()) + 1) % 3]);
$$('#cams button').forEach(b => b.onclick = () => { setCamView(b.dataset.c); goTo(fitGoal(b.dataset.c, state.view.explode)); });
const viewPop = $('#viewPop'), viewBtn = $('#viewBtn');
const togglePop = (open) => { viewPop.hidden = !open; viewBtn.setAttribute('aria-expanded', String(open)); };
viewBtn.onclick = () => togglePop(viewPop.hidden);
document.addEventListener('pointerdown', (e) => { if (!viewPop.hidden && !e.target.closest('.viewwrap')) togglePop(false); });
$('#hudBtn').onclick = () => {
  hudOn = !hudOn; $('#app').classList.toggle('hud-off', !hudOn); togglePop(false);
  $('#hudBtn').textContent = hudOn ? 'Hide panels' : 'Show panels';
  goTo(fitGoal(camView || undefined, state.view.explode));
};

/* ================= Loop ================= */
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(1, Math.round(stage.clientWidth * dpr)), h = Math.max(1, Math.round(stage.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
}
new ResizeObserver(() => { resize(); pv.dirty = true; if (result && !drag) goTo(fitGoal(camView || undefined, state.view.explode), true); }).observe(stage);
function frame(now) {
  now = now || 0; const dt = Math.min(0.1, (now - pv.last) / 1000); pv.last = now;
  const idle = !reduceMotion && now - lastInput > IDLE_MS;
  if (idle && !pv.auto && !pv.ptr) pv.auto = true;
  if (pv.auto) { pv.az += dt * 0.45; pv.dirty = true; }
  if (pv.dirty && result) { pv.dirty = false; if (drawPartView()) dirty = true; }
  if (result && !reduceMotion && !drag && !state.pin && !state.hover && (auto.on || idle)) {
    if (!auto.on || auto.step < 0) { auto.on = true; auto.rev = 0; auto.fired = false; auto.step = Math.max(0, SEQ.indexOf(currentMode())); }
    const da = dt * TURN; cam.az += da; auto.rev += da; dirty = true;
    if (cam.goal) cam.goal.az = cam.az;
    const turn = stepTurn(auto.step);
    if (!auto.fired && auto.rev > turn - LEAD) { auto.fired = true; auto.slow = true; applyMode(SEQ[(auto.step + 1) % SEQ.length]); }
    if (auto.rev >= turn) { auto.rev = 0; auto.fired = false; auto.step = (auto.step + 1) % SEQ.length; }
  }
  const k = 1 - Math.exp(-dt * (auto.slow ? 1.5 : 10)), v = state.view;
  if (cam.goal) {
    const g = cam.goal, kc = auto.slow ? k : 0.16;
    cam.az += (g.az - cam.az) * kc; cam.el += (g.el - cam.el) * kc; cam.d += (g.d - cam.d) * kc; cam.t = cam.t.map((x, i) => x + (g.t[i] - x) * kc);
    if (Math.abs(g.az - cam.az) < 0.001 && Math.abs(g.el - cam.el) < 0.001 && Math.abs(g.d - cam.d) < 1) Object.assign(cam, g, { goal: null });
    dirty = true;
  }
  for (const [a, flag] of [['lidA', 'lid'], ['frontA', 'front']]) {
    const tgt = v[flag] ? 1 : 0;
    if (v[a] !== tgt) { v[a] += (tgt - v[a]) * k; if (Math.abs(tgt - v[a]) < 0.01) v[a] = tgt; dirty = true; }
  }
  if (explodeGoal !== null) {
    v.explode += (explodeGoal - v.explode) * k;
    if (Math.abs(explodeGoal - v.explode) < 0.004) { v.explode = explodeGoal; explodeGoal = null; }
    dirty = true;
  }
  if (dirty) { dirty = false; try { draw(); } catch (err) { showError(err.message); return; } }
  requestAnimationFrame(frame);
}

setTab('overview'); setCamView('iso'); resize();
{ const raw = atob(GLB64[PARTS[0].id]), bin = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i); setPart({ ...PARTS[0] }, parseGlb(bin), 4); }
requestAnimationFrame(frame);
})();
