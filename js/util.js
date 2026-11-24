import * as THREE from '../lib/three.module.min.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function hash2(x, z, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Merge geometries into one non-indexed geometry with per-part vertex colours. */
export function mergeGeos(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    const pa = g.attributes.position.array, na = g.attributes.normal.array;
    for (let i = 0; i < pa.length; i++) { pos.push(pa[i]); nor.push(na[i]); }
    c.set(p.color ?? 0xffffff);
    for (let i = 0; i < pa.length / 3; i++) col.push(c.r, c.g, c.b);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** Single geometry with white vertex colours, optionally transformed. */
export function part(geo, matrix, color = 0xffffff) {
  return mergeGeos([{ geo, matrix, color }]);
}

/** Ray vs vertical infinite cylinder (XZ circle). Returns smallest t>=0 or -1. d need not be normalised in XZ. */
export function rayCircleT(ox, oz, dx, dz, cx, cz, r) {
  const a = dx * dx + dz * dz;
  if (a < 1e-10) return -1;
  const fx = ox - cx, fz = oz - cz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t0 = (-b - s) / (2 * a);
  if (t0 >= 0) return t0;
  const t1 = (-b + s) / (2 * a);
  return t1 >= 0 ? 0 : -1;
}

/** Ray vs sphere. Returns t or -1. d must be normalised. */
export function raySphereT(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const fx = ox - cx, fy = oy - cy, fz = oz - cz;
  const b = fx * dx + fy * dy + fz * dz;
  const c = fx * fx + fy * fy + fz * fz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  if (t0 >= 0) return t0;
  const t1 = -b + s;
  return t1 >= 0 ? 0 : -1;
}

export function fmtTime(s) {
  s = Math.floor(s);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/** Merge textured geometries (position/normal/uv) into one non-indexed geometry. */
export function mergeUV(geos) {
  const pos = [], nor = [], uv = [];
  for (const geo of geos) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pa = g.attributes.position.array, na = g.attributes.normal.array, ua = g.attributes.uv.array;
    for (let i = 0; i < pa.length; i++) { pos.push(pa[i]); nor.push(na[i]); }
    for (let i = 0; i < ua.length; i++) uv.push(ua[i]);
    if (g !== geo) g.dispose();
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

/** Bake a hierarchy of vertex-coloured meshes into one geometry (material colour baked into vertex colours). */
export function bakeGroup(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pos = [], nor = [], col = [];
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), c = new THREE.Color();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let p = o.parent, vis = true;
    while (p && p !== root) { if (!p.visible) vis = false; p = p.parent; }
    if (!vis) return;
    m.multiplyMatrices(inv, o.matrixWorld); nm.getNormalMatrix(m);
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const pa = g.attributes.position, na = g.attributes.normal, ca = g.attributes.color;
    const mc = o.material.color || c.set(0xffffff);
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
      if (ca) col.push(ca.getX(i) * mc.r, ca.getY(i) * mc.g, ca.getZ(i) * mc.b); else col.push(mc.r, mc.g, mc.b);
    }
    if (g !== o.geometry) g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** Ray (unit d, t>=0) vs capsule a-b radius r. Returns entry t or -1. */
export function rayCapsuleT(o, d, a, b, r) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const wx = o.x - a.x, wy = o.y - a.y, wz = o.z - a.z;
  const B = d.x * ux + d.y * uy + d.z * uz, C = ux * ux + uy * uy + uz * uz;
  const D = d.x * wx + d.y * wy + d.z * wz, E = ux * wx + uy * wy + uz * wz;
  const den = C - B * B;
  let t, s;
  if (den < 1e-9) { s = 0; t = -D; } else { t = (B * E - C * D) / den; s = (E - B * D) / den; }
  if (s < 0 || s > 1) { s = clamp(s, 0, 1); t = s * B - D; }
  if (t < 0) { t = 0; s = C > 1e-9 ? clamp(E / C, 0, 1) : 0; }
  const px = o.x + d.x * t - (a.x + ux * s), py = o.y + d.y * t - (a.y + uy * s), pz = o.z + d.z * t - (a.z + uz * s);
  const d2 = px * px + py * py + pz * pz;
  if (d2 > r * r) return -1;
  return Math.max(0, t - Math.sqrt(r * r - d2));
}
