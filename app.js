'use strict';
/* DrawPad – mobile-first canvas drawing PWA */
const W = 1080, H = 1440, G = 4, MAXH = 60;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx = c => c.getContext('2d', { willReadFrequently: true });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const view = $('#view'), ov = $('#overlay'), board = $('#board'), stage = $('#stage');
view.width = ov.width = W; view.height = ov.height = H; board.style.width = W + 'px'; board.style.height = H + 'px';
const vg = view.getContext('2d'), og = ov.getContext('2d');

const S = { tool: 'pen', color: '#ff4d6d', size: 24, opacity: 1, soft: .6, sm: .75, smAll: '1', lStyle: 'glow', lMode: 'auto', liq: .6 };
let layers = [], activeId = null, uid = 1;
let bg = { type: 'gradient', color: '#1b1d24', c1: '#1d1640', c2: '#0d2a3a', angle: 160, img: null };
const vw = { s: 1, tx: 0, ty: 0 };
let stroke = null; // live brush stroke, for preview compositing

/* ---------- layers ---------- */
function newPaint(name) { return { id: uid++, type: 'paint', name: name || 'Layer', canvas: mk(W, H), visible: true, opacity: 1, blend: 'source-over', ox: 0, oy: 0 }; }
function gridMesh(w, h) { const m = []; for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) m.push(i / G * w, j / G * h); return m; }
function newImage(src, name) {
  return { id: uid++, type: 'image', name: name || 'Picture', src, visible: true, opacity: 1, blend: 'source-over',
    x: W / 2, y: H / 2, s: Math.min(W * .85 / src.width, H * .85 / src.height, 2), rot: 0, fx: 1, fy: 1,
    mesh: gridMesh(src.width, src.height), warped: false, mask: null, cache: mk(W, H), dirty: true };
}
const act = () => layers.find(l => l.id === activeId) || layers[layers.length - 1];
const aff = L => new DOMMatrix().translate(L.x, L.y).rotate(L.rot * 180 / Math.PI).scale(L.s * L.fx, L.s * L.fy).translate(-L.src.width / 2, -L.src.height / 2);

function tri(g, img, s0, s1, s2, d0, d1, d2) {
  const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2, [u0, v0] = d0, [u1, v1] = d1, [u2, v2] = d2;
  const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0); if (!den) return;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / den, c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / den;
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / den, d = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / den;
  const e = u0 - a * x0 - c * y0, f = v0 - b * x0 - d * y0;
  const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3, ex = p => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * 1.2, p[1] + dy / l * 1.2]; };
  const p0 = ex(d0), p1 = ex(d1), p2 = ex(d2);
  g.save(); g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.lineTo(...p2); g.closePath(); g.clip();
  g.transform(a, b, c, d, e, f); g.drawImage(img, 0, 0); g.restore();
}
function renderImage(L) {
  const g = L.cache.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
  g.setTransform(aff(L)); g.imageSmoothingQuality = 'high';
  if (!L.warped) g.drawImage(L.src, 0, 0);
  else {
    const w = L.src.width, h = L.src.height, m = L.mesh, P = (i, j) => { const k = (j * (G + 1) + i) * 2; return [m[k], m[k + 1]]; }, Q = (i, j) => [i / G * w, j / G * h];
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      tri(g, L.src, Q(i, j), Q(i + 1, j), Q(i + 1, j + 1), P(i, j), P(i + 1, j), P(i + 1, j + 1));
      tri(g, L.src, Q(i, j), Q(i + 1, j + 1), Q(i, j + 1), P(i, j), P(i + 1, j + 1), P(i, j + 1));
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (L.mask) { g.globalCompositeOperation = 'destination-out'; g.drawImage(L.mask, 0, 0); g.globalCompositeOperation = 'source-over'; }
  L.dirty = false;
}
function layerPixels(L) { if (L.type === 'image') { if (L.dirty) renderImage(L); return L.cache; } return L.canvas; }

/* ---------- background ---------- */
const tex = {};
function texture(kind) {
  if (tex[kind]) return tex[kind];
  const c = mk(W, H), g = ctx(c); g.fillStyle = kind === 'paper' ? '#f2ece0' : '#141519'; g.fillRect(0, 0, W, H);
  const id = g.getImageData(0, 0, W, H), d = id.data, amp = kind === 'paper' ? 16 : 12;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - .5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(id, 0, 0);
  for (let i = 0; i < 900; i++) {
    g.strokeStyle = kind === 'paper' ? `rgba(120,100,70,${Math.random() * .07})` : `rgba(150,160,190,${Math.random() * .05})`;
    g.lineWidth = Math.random() * 1.4; g.beginPath(); const x = Math.random() * W, y = Math.random() * H, a = Math.random() * 6.3, l = 5 + Math.random() * 30;
    g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l, y + Math.sin(a) * l * .3, x + Math.cos(a + .4) * l * 1.6, y + Math.sin(a + .4) * l); g.stroke();
  }
  if (kind === 'dark') { const r = g.createRadialGradient(W / 2, H * .4, 100, W / 2, H / 2, H * .8); r.addColorStop(0, 'rgba(60,70,100,.18)'); r.addColorStop(1, 'rgba(0,0,0,.45)'); g.fillStyle = r; g.fillRect(0, 0, W, H); }
  return tex[kind] = c;
}
function drawBG(g) {
  const t = bg.type;
  if (t === 'solid') { g.fillStyle = bg.color; g.fillRect(0, 0, W, H); }
  else if (t === 'gradient') {
    const a = bg.angle * Math.PI / 180, r = Math.hypot(W, H) / 2, dx = Math.cos(a) * r, dy = Math.sin(a) * r;
    const gr = g.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy); gr.addColorStop(0, bg.c1); gr.addColorStop(1, bg.c2); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  } else if (t === 'paper' || t === 'dark') g.drawImage(texture(t), 0, 0);
  else if (t === 'image' && bg.img) g.drawImage(bg.img, 0, 0, W, H);
}
function coverCanvas(src) {
  const c = mk(W, H), g = c.getContext('2d'), s = Math.max(W / src.width, H / src.height);
  g.imageSmoothingQuality = 'high'; g.drawImage(src, (W - src.width * s) / 2, (H - src.height * s) / 2, src.width * s, src.height * s); return c;
}

/* ---------- compositing ---------- */
const tmp = mk(W, H), tg = tmp.getContext('2d');
function composite(g, withBg = true) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, W, H);
  if (withBg) drawBG(g);
  for (const L of layers) {
    if (!L.visible) continue;
    let px = layerPixels(L), ox = L.ox || 0, oy = L.oy || 0;
    if (stroke && stroke.L === L) {
      tg.globalCompositeOperation = 'source-over'; tg.globalAlpha = 1; tg.clearRect(0, 0, W, H); tg.drawImage(px, 0, 0);
      tg.globalAlpha = stroke.alpha; tg.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'; tg.drawImage(stroke.buf, 0, 0);
      tg.globalAlpha = 1; tg.globalCompositeOperation = 'source-over'; px = tmp;
    }
    g.globalAlpha = L.opacity; g.globalCompositeOperation = L.blend; g.drawImage(px, ox, oy);
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
}
let raf = 0;
function req() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; composite(vg, true); drawOverlay(); }); }
function renderNow() { if (raf) { cancelAnimationFrame(raf); raf = 0; } composite(vg, true); drawOverlay(); }
function drawOverlay() {
  og.setTransform(1, 0, 0, 1, 0, 0); og.clearRect(0, 0, W, H);
  const L = act(); if (!L || L.type !== 'image' || !L.visible || !(S.tool === 'warp' || S.tool === 'move')) return;
  const M = aff(L), u = 1 / vw.s, w = L.src.width, h = L.src.height;
  const tp = (x, y) => M.transformPoint(new DOMPoint(x, y));
  og.lineWidth = 2 * u;
  if (S.tool === 'move') {
    og.strokeStyle = '#8b6cff'; og.setLineDash([8 * u, 6 * u]); og.beginPath();
    [[0, 0], [w, 0], [w, h], [0, h]].forEach(([x, y], i) => { const p = tp(x, y); i ? og.lineTo(p.x, p.y) : og.moveTo(p.x, p.y); }); og.closePath(); og.stroke(); og.setLineDash([]);
    return;
  }
  const m = L.mesh, P = (i, j) => tp(m[(j * (G + 1) + i) * 2], m[(j * (G + 1) + i) * 2 + 1]);
  og.strokeStyle = 'rgba(255,255,255,.75)'; og.beginPath();
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) { const p = P(i, j); if (i < G) { const q = P(i + 1, j); og.moveTo(p.x, p.y); og.lineTo(q.x, q.y); } if (j < G) { const q = P(i, j + 1); og.moveTo(p.x, p.y); og.lineTo(q.x, q.y); } }
  og.stroke();
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) { const p = P(i, j); og.beginPath(); og.arc(p.x, p.y, 11 * u, 0, 7); og.fillStyle = '#8b6cff'; og.fill(); og.strokeStyle = '#fff'; og.stroke(); }
}

/* ---------- history ---------- */
const undoS = [], redoS = [];
function push(e) { undoS.push(e); if (undoS.length > MAXH) undoS.shift(); redoS.length = 0; changed(); }
function undo() { const e = undoS.pop(); if (!e) return; e.undo(); redoS.push(e); changed(); }
function redo() { const e = redoS.pop(); if (!e) return; e.redo(); undoS.push(e); changed(); }
function beginEdit(c) { return { c, before: ctx(c).getImageData(0, 0, c.width, c.height), x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }; }
function touch(E, x, y, r) { E.x0 = Math.min(E.x0, x - r); E.y0 = Math.min(E.y0, y - r); E.x1 = Math.max(E.x1, x + r); E.y1 = Math.max(E.y1, y + r); }
function crop(id, x, y, w, h) { const o = new ImageData(w, h); for (let r = 0; r < h; r++) o.data.set(id.data.subarray(((y + r) * id.width + x) * 4, ((y + r) * id.width + x + w) * 4), r * w * 4); return o; }
function endEdit(E, after) {
  const c = E.c, x = clamp(Math.floor(E.x0) - 2, 0, c.width), y = clamp(Math.floor(E.y0) - 2, 0, c.height);
  const w = clamp(Math.ceil(E.x1) + 2, 0, c.width) - x, h = clamp(Math.ceil(E.y1) + 2, 0, c.height) - y;
  if (w <= 0 || h <= 0) return null;
  const b = crop(E.before, x, y, w, h), a = ctx(c).getImageData(x, y, w, h), g = ctx(c);
  return { undo() { g.putImageData(b, x, y); after && after(); }, redo() { g.putImageData(a, x, y); after && after(); } };
}
function group(list) { list = list.filter(Boolean); return list.length ? { undo() { [...list].reverse().forEach(e => e.undo()); }, redo() { list.forEach(e => e.redo()); } } : null; }
function snapStruct() { return { arr: layers.slice(), act: activeId }; }
function structEntry(b) { const a = snapStruct(); return { undo() { layers = b.arr.slice(); activeId = b.act; refreshLayers(); }, redo() { layers = a.arr.slice(); activeId = a.act; refreshLayers(); } }; }
function metaOf(L) { const m = { visible: L.visible, opacity: L.opacity, blend: L.blend, name: L.name }; if (L.type === 'image') Object.assign(m, { x: L.x, y: L.y, s: L.s, rot: L.rot, fx: L.fx, fy: L.fy, mesh: L.mesh.slice(), warped: L.warped }); return m; }
function applyMeta(L, m) { Object.assign(L, m); if (m.mesh) L.mesh = m.mesh.slice(); L.dirty = true; }
function pushMeta(L, b) { const a = metaOf(L); if (JSON.stringify(a) === JSON.stringify(b)) return; push({ undo() { applyMeta(L, b); refreshLayers(); }, redo() { applyMeta(L, a); refreshLayers(); } }); }
function pushBg(b) { const a = { ...bg }; push({ undo() { bg = { ...b }; refreshBg(); }, redo() { bg = { ...a }; refreshBg(); } }); }

/* ---------- helpers ---------- */
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`; };
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 1800); }
function hud(t) { const e = $('#hud'); if (!t) { e.style.display = 'none'; return; } e.style.display = 'block'; e.textContent = t; }
function insertAbove(L, ref) { const i = ref ? layers.indexOf(ref) : layers.length - 1; layers.splice(i + 1, 0, L); activeId = L.id; }
/* returns a paint layer to draw on; creates one above a picture layer when needed (records history in `hist`) */
function ensurePaint(hist, name) {
  const L = act(); if (L && L.type === 'paint') return L;
  const b = snapStruct(), N = newPaint(name || 'Paint ' + uid); insertAbove(N, L); hist.push(structEntry(b)); refreshLayers(); return N;
}
function ensureFx(hist, tag, name, blend) {
  let L = layers.find(l => l.fx === tag); if (L) return L;
  const b = snapStruct(); L = newPaint(name); L.fx = tag; L.blend = blend; layers.push(L); activeId = act()?.id; hist.push(structEntry(b)); refreshLayers(); return L;
}

/* ---------- brushes ---------- */
const buf = mk(W, H), bg2 = buf.getContext('2d');
function stampBrush(g, x, y, r, tool) {
  if (tool === 'pen') { g.fillStyle = S.color; g.beginPath(); g.arc(x, y, Math.max(r, .5), 0, 7); g.fill(); }
  else if (tool === 'marker') { g.save(); g.translate(x, y); g.rotate(-.6); g.fillStyle = S.color; g.beginPath(); g.ellipse(0, 0, r, r * .45, 0, 0, 7); g.fill(); g.restore(); }
  else if (tool === 'air') { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgba(S.color, .14)); gr.addColorStop(1, rgba(S.color, 0)); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  else if (tool === 'eraser') { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, '#000'); gr.addColorStop(clamp(1 - S.soft, 0, .99), '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
}
const spacingOf = { pen: .15, marker: .12, air: .18, eraser: .15 };
function brushAction(p) {
  const hist = [], tool = S.tool; let L = act(), target, erase = false, maskMode = false;
  if (tool === 'eraser') {
    if (L.type === 'image') { if (!L.mask) L.mask = mk(W, H); target = L.mask; maskMode = true; }
    else { target = L.canvas; }
    erase = true;
  } else { L = ensurePaint(hist); target = L.canvas; }
  const E = beginEdit(target);
  bg2.clearRect(0, 0, W, H);
  stroke = { L, buf, alpha: tool === 'marker' ? S.opacity * .85 : S.opacity, erase };
  const base = tool === 'air' ? S.size * 1.6 : S.size / 2; let last = p, carry = 0;
  const dab = q => { const r = base * q.pr; stampBrush(bg2, q.x, q.y, r, tool); touch(E, q.x, q.y, r + 2); };
  dab(p); req();
  return {
    move(q) {
      const d = Math.hypot(q.x - last.x, q.y - last.y), step = Math.max(1, base * spacingOf[tool] * Math.min(q.pr, last.pr));
      let t = step - carry; while (t <= d) { const k = t / d; dab({ x: last.x + (q.x - last.x) * k, y: last.y + (q.y - last.y) * k, pr: last.pr + (q.pr - last.pr) * k }); t += step; }
      carry = d - (t - step); last = q; req();
    },
    end() {
      const g = ctx(target); g.globalAlpha = stroke.alpha; g.globalCompositeOperation = maskMode ? 'source-over' : (erase ? 'destination-out' : 'source-over');
      g.drawImage(buf, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; stroke = null;
      if (maskMode) L.dirty = true;
      hist.push(endEdit(E, () => { L.dirty = true; })); push(group(hist));
    },
    abort() { stroke = null; hist.reverse().forEach(e => e && e.undo()); refreshLayers(); }
  };
}

/* ---------- smudge ---------- */
function smudgeAction(p) {
  const hist = [], srcL = act();
  const target = ensurePaint(hist, 'Smudge'); const E = beginEdit(target.canvas), g = ctx(target.canvas);
  const r = Math.max(2, Math.round(S.size / 2)), d = r * 2, carry = mk(d, d), cg = ctx(carry), mcv = mk(d, d), mg = mcv.getContext('2d');
  const source = () => S.smAll === '1' ? view : layerPixels(srcL === target || srcL.type === 'image' ? srcL : target);
  renderNow(); cg.drawImage(source(), p.x - r, p.y - r, d, d, 0, 0, d, d);
  let last = p;
  const dab = (x, y) => {
    mg.globalCompositeOperation = 'copy'; mg.drawImage(carry, 0, 0); mg.globalCompositeOperation = 'destination-in';
    const gr = mg.createRadialGradient(r, r, 0, r, r, r); gr.addColorStop(0, '#000'); gr.addColorStop(.5, 'rgba(0,0,0,.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); mg.fillStyle = gr; mg.fillRect(0, 0, d, d);
    mg.globalCompositeOperation = 'source-over';
    g.globalAlpha = S.sm; g.drawImage(mcv, x - r, y - r); g.globalAlpha = 1; touch(E, x, y, r + 2);
    if (S.smAll === '1') composite(vg, true);
    cg.globalAlpha = 1 - S.sm * .9; cg.drawImage(source(), x - r, y - r, d, d, 0, 0, d, d); cg.globalAlpha = 1;
  };
  return {
    move(q) { const dist = Math.hypot(q.x - last.x, q.y - last.y), step = Math.max(1, r * .2); if (dist < step) return; const n = Math.floor(dist / step); for (let i = 1; i <= n; i++) dab(last.x + (q.x - last.x) * i / n, last.y + (q.y - last.y) * i / n); last = q; req(); },
    end() { hist.push(endEdit(E)); push(group(hist)); },
    abort() { ctx(target.canvas).putImageData(E.before, 0, 0); hist.reverse().forEach(e => e && e.undo()); refreshLayers(); }
  };
}

/* ---------- light ---------- */
function blob(g, x, y, r, stops, ang = 0, sx = 1, sy = 1) {
  g.save(); g.translate(x, y); g.rotate(ang); g.scale(sx, sy);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); stops.forEach(([o, c]) => gr.addColorStop(o, c)); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.restore();
}
function lightShape(g, x, y, r, ang, style, core, mid, alt) {
  const T = 'rgba(0,0,0,0)';
  if (style === 'glow') blob(g, x, y, r, [[0, core], [.25, mid], [1, T]]);
  else if (style === 'rim') { blob(g, x, y, r * .6, [[0, mid], [1, T]]); blob(g, x, y, Math.max(2, r * .14), [[0, core], [.6, core], [1, T]]); }
  else if (style === 'streak') { blob(g, x, y, r, [[0, mid], [1, T]], ang, 2.6, .32); blob(g, x, y, r, [[0, core], [1, T]], ang, 3.2, .07); }
  else if (style === 'lens') {
    blob(g, x, y, r * 1.1, [[0, core], [.2, mid], [1, T]]);
    g.save(); g.strokeStyle = alt; g.lineWidth = Math.max(1, r * .05); g.beginPath(); g.arc(x, y, r * .85, 0, 7); g.stroke();
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + .3, L = r * (k % 2 ? 1.4 : 2.3); const lg = g.createLinearGradient(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L); lg.addColorStop(0, core); lg.addColorStop(1, T); g.strokeStyle = lg; g.lineWidth = Math.max(1, r * .04); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke(); }
    blob(g, x + r * 1.6, y + r * 1.1, r * .25, [[0, alt], [1, T]]); g.restore();
  }
}
function lightAction(p) {
  const hist = [];
  renderNow();
  const lm = mk(W / 10, H / 10), lg = ctx(lm); lg.drawImage(view, 0, 0, lm.width, lm.height); const ld = lg.getImageData(0, 0, lm.width, lm.height).data;
  const lum = (x, y) => { let s = 0, n = 0; const cx = Math.round(x / 10), cy = Math.round(y / 10); for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const X = clamp(cx + i, 0, lm.width - 1), Y = clamp(cy + j, 0, lm.height - 1), k = (Y * lm.width + X) * 4; s += (.2126 * ld[k] + .7152 * ld[k + 1] + .0722 * ld[k + 2]) / 255; n++; } return s / n; };
  const prevAct = activeId;
  const glow = ensureFx(hist, 'glow', '✦ Light glow', 'lighter'), sheen = ensureFx(hist, 'sheen', '✦ Light sheen', 'overlay');
  activeId = prevAct; refreshLayers();
  const E1 = beginEdit(glow.canvas), E2 = beginEdit(sheen.canvas), g1 = ctx(glow.canvas), g2 = ctx(sheen.canvas);
  const sp = { glow: .35, rim: .1, streak: .45, lens: 1.8 }[S.lStyle];
  const r = S.size * 1.2, a = S.opacity; let last = p, carry = 0, ang = 0, counts = { glow: 0, sheen: 0 };
  const dab = (x, y) => {
    const L = lum(x, y); const mode = S.lMode === 'auto' ? (L < .5 ? 'glow' : 'sheen') : S.lMode; counts[mode]++;
    hud(`${S.lMode === 'auto' ? 'Auto' : 'Manual'} · background ${L < .5 ? 'dark' : 'bright'} (${Math.round(L * 100)}%) → ${mode === 'glow' ? 'additive shine' : 'reflective sheen'}`);
    if (mode === 'glow') {
      const k = S.lMode === 'auto' ? clamp(1.1 - L, .4, 1) : 1;
      g1.globalCompositeOperation = 'lighter';
      lightShape(g1, x, y, r, ang, S.lStyle, `rgba(255,255,255,${.55 * a * k})`, rgba(S.color, .4 * a * k), rgba(S.color, .35 * a));
      g1.globalCompositeOperation = 'source-over'; touch(E1, x, y, r * 3.4);
    } else {
      lightShape(g2, x + r * .22, y + r * .3, r * 1.25, ang, S.lStyle, `rgba(0,0,0,${.32 * a})`, `rgba(0,0,0,${.18 * a})`, `rgba(0,0,0,${.2 * a})`);
      lightShape(g2, x, y, r * .9, ang, S.lStyle, `rgba(255,255,255,${.9 * a})`, rgba(S.color, .45 * a), `rgba(255,255,255,${.5 * a})`);
      touch(E2, x, y, r * 4);
    }
  };
  dab(p.x, p.y); req();
  return {
    move(q) {
      const d = Math.hypot(q.x - last.x, q.y - last.y); if (d < 1) return; ang = Math.atan2(q.y - last.y, q.x - last.x);
      const step = Math.max(1, r * sp); let t = step - carry; while (t <= d) { const k = t / d; dab(last.x + (q.x - last.x) * k, last.y + (q.y - last.y) * k); t += step; }
      carry = d - (t - step); last = q; req();
    },
    end() { hud(); hist.push(endEdit(E1), endEdit(E2)); push(group(hist)); window.__lastLight = counts; },
    abort() { hud(); g1.putImageData(E1.before, 0, 0); g2.putImageData(E2.before, 0, 0); hist.reverse().forEach(e => e && e.undo()); refreshLayers(); }
  };
}

/* ---------- liquify ---------- */
function liquify(c, cx, cy, dx, dy, r, k) {
  const x0 = clamp(Math.floor(cx - r), 0, c.width), y0 = clamp(Math.floor(cy - r), 0, c.height), x1 = clamp(Math.ceil(cx + r), 0, c.width), y1 = clamp(Math.ceil(cy + r), 0, c.height);
  const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
  const g = ctx(c), id = g.getImageData(x0, y0, w, h), o = id.data, s = new Uint8ClampedArray(o), r2 = r * r;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x0 + x - cx, py = y0 + y - cy, d2 = px * px + py * py; if (d2 >= r2) continue;
    const f = (1 - d2 / r2) ** 2 * k, sx = clamp(x - dx * f, 0, w - 1.001), sy = clamp(y - dy * f, 0, h - 1.001);
    const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy, i00 = (iy * w + ix) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4, j = (y * w + x) * 4;
    for (let ch = 0; ch < 4; ch++) o[j + ch] = (s[i00 + ch] * (1 - fx) + s[i10 + ch] * fx) * (1 - fy) + (s[i01 + ch] * (1 - fx) + s[i11 + ch] * fx) * fy;
  }
  g.putImageData(id, x0, y0);
}
function liquifyAction(p) {
  const L = act(); const img = L.type === 'image';
  const target = img ? L.src : L.canvas, inv = img ? aff(L).inverse() : null, map = q => img ? inv.transformPoint(new DOMPoint(q.x, q.y)) : q;
  const scl = img ? 1 / L.s : 1, R = S.size * scl * 1.2; const E = beginEdit(target); let last = map(p);
  return {
    move(q) {
      const m = map(q), dx = m.x - last.x, dy = m.y - last.y, d = Math.hypot(dx, dy); if (d < .5) return;
      const n = Math.ceil(d / (R * .2)); for (let i = 1; i <= n; i++) { const cx = last.x + dx * i / n, cy = last.y + dy * i / n; liquify(target, cx, cy, dx / n, dy / n, R, S.liq * 1.6); touch(E, cx, cy, R); }
      last = m; if (img) L.dirty = true; req();
    },
    end() { push(endEdit(E, () => { L.dirty = true; })); },
    abort() { ctx(target).putImageData(E.before, 0, 0); L.dirty = true; req(); }
  };
}

/* ---------- warp / move ---------- */
function warpAction(p) {
  const L = act(); if (L.type !== 'image') { toast('Select a picture layer to warp'); return null; }
  const M = aff(L), inv = M.inverse(), b = metaOf(L), hr = 30 / vw.s; let best = -1, bd = hr;
  for (let k = 0; k < L.mesh.length; k += 2) { const q = M.transformPoint(new DOMPoint(L.mesh[k], L.mesh[k + 1])), d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = k; } }
  if (best < 0) return null;
  const s = inv.transformPoint(new DOMPoint(p.x, p.y)), off = [L.mesh[best] - s.x, L.mesh[best + 1] - s.y];
  return {
    move(q) { const l = inv.transformPoint(new DOMPoint(q.x, q.y)); L.mesh[best] = l.x + off[0]; L.mesh[best + 1] = l.y + off[1]; L.warped = true; L.dirty = true; req(); },
    end() { pushMeta(L, b); }, abort() { applyMeta(L, b); req(); }
  };
}
function moveAction(p) {
  const L = act();
  if (L.type === 'paint') {
    return { move(q) { L.ox = q.x - p.x; L.oy = q.y - p.y; req(); },
      end() { const E = beginEdit(L.canvas), g = ctx(L.canvas), dx = Math.round(L.ox), dy = Math.round(L.oy); L.ox = L.oy = 0; tg.clearRect(0, 0, W, H); tg.drawImage(L.canvas, 0, 0); g.clearRect(0, 0, W, H); g.drawImage(tmp, dx, dy); touch(E, W / 2, H / 2, H); push(endEdit(E)); },
      abort() { L.ox = L.oy = 0; req(); } };
  }
  const b = metaOf(L);
  return { move(q) { L.x = b.x + q.x - p.x; L.y = b.y + q.y - p.y; L.dirty = true; req(); syncMoveUI(); }, end() { pushMeta(L, b); }, abort() { applyMeta(L, b); req(); } };
}

/* ---------- pointer / gestures ---------- */
const ptrs = new Map(); let action = null, pinch = null, panning = null, spaceDown = false;
function toDoc(e) { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left - vw.tx) / vw.s, y: (e.clientY - r.top - vw.ty) / vw.s }; }
function pressure(e) { return e.pointerType === 'pen' && e.pressure > 0 ? .15 + e.pressure * .85 : 1; }
function applyView() { board.style.transform = `translate(${vw.tx}px,${vw.ty}px) scale(${vw.s})`; drawOverlay(); }
function fit() { const r = stage.getBoundingClientRect(); vw.s = Math.min(r.width / W, r.height / H) * .94; vw.tx = (r.width - W * vw.s) / 2; vw.ty = (r.height - H * vw.s) / 2; applyView(); }
function startPinch() {
  const [a, b] = [...ptrs.values()], r = stage.getBoundingClientRect();
  const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
  const L = act();
  pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), a0: Math.atan2(b.y - a.y, b.x - a.x), mid0: mid, v0: { ...vw }, layer: S.tool === 'move' && L.type === 'image' ? L : null };
  if (pinch.layer) pinch.meta = metaOf(L);
}
function movePinch() {
  const [a, b] = [...ptrs.values()], r = stage.getBoundingClientRect();
  const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), P = pinch;
  if (P.layer) { const L = P.layer, m = P.meta; L.s = clamp(m.s * d / P.d0, .02, 20); L.rot = m.rot + ang - P.a0; L.x = m.x + (mid.x - P.mid0.x) / vw.s; L.y = m.y + (mid.y - P.mid0.y) / vw.s; L.dirty = true; req(); syncMoveUI(); return; }
  const s = clamp(P.v0.s * d / P.d0, .05, 12), px = (P.mid0.x - P.v0.tx) / P.v0.s, py = (P.mid0.y - P.v0.ty) / P.v0.s;
  vw.s = s; vw.tx = mid.x - s * px; vw.ty = mid.y - s * py; applyView();
}
stage.addEventListener('pointerdown', e => {
  stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) { if (action) { action.abort(); action = null; } startPinch(); return; }
  if (ptrs.size > 2) return;
  if (e.button === 1 || e.button === 2 || spaceDown) { panning = { x: e.clientX, y: e.clientY, tx: vw.tx, ty: vw.ty }; return; }
  const p = { ...toDoc(e), pr: pressure(e) }, L = act(); if (!L) return;
  if (!L.visible && S.tool !== 'light') { toast('Selected layer is hidden'); return; }
  const f = { pen: brushAction, air: brushAction, marker: brushAction, eraser: brushAction, smudge: smudgeAction, light: lightAction, liquify: liquifyAction, warp: warpAction, move: moveAction }[S.tool];
  action = f(p);
});
stage.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size >= 2) { movePinch(); return; }
  if (panning) { vw.tx = panning.tx + e.clientX - panning.x; vw.ty = panning.ty + e.clientY - panning.y; applyView(); return; }
  if (action) { const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for (const ev of (evs.length ? evs : [e])) action.move({ ...toDoc(ev), pr: pressure(ev) }); }
});
function up(e) {
  if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
  if (pinch) { if (ptrs.size < 2) { if (pinch.layer) pushMeta(pinch.layer, pinch.meta); pinch = null; } return; }
  panning = null; if (action) { action.end(); action = null; }
}
stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
stage.addEventListener('contextmenu', e => e.preventDefault());
stage.addEventListener('wheel', e => {
  e.preventDefault(); const r = stage.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  if (e.ctrlKey || !e.shiftKey) { const s = clamp(vw.s * Math.exp(-e.deltaY * .0015), .05, 12), px = (mx - vw.tx) / vw.s, py = (my - vw.ty) / vw.s; vw.s = s; vw.tx = mx - s * px; vw.ty = my - s * py; }
  else { vw.tx -= e.deltaX; vw.ty -= e.deltaY; } applyView();
}, { passive: false });
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  if (e.code === 'Space') spaceDown = true;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
});
addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });
new ResizeObserver(() => fit()).observe(stage);

/* ---------- UI ---------- */
function setTool(t) {
  S.tool = t; $$('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  $$('#opts .orow').forEach(r => r.classList.toggle('show', r.classList.contains('t-' + t)));
  $$('#opts .orow [class*="t-"]').forEach(el => el.classList.toggle('t-hide', !el.classList.contains('t-' + t)));
  syncMoveUI(); req();
}
$$('#tools button').forEach(b => b.onclick = () => setTool(b.dataset.tool));
function bindRange(id, key, lab, toV, fromV, fmt) {
  const el = $(id), l = $(lab); el.value = fromV(S[key]); const show = () => l.textContent = fmt(S[key]);
  el.oninput = () => { S[key] = toV(+el.value); show(); savePrefs(); }; show();
}
function initControls() {
  bindRange('#oSize', 'size', '#vSize', v => v, v => v, v => v + 'px');
  bindRange('#oOp', 'opacity', '#vOp', v => v / 100, v => v * 100, v => Math.round(v * 100) + '%');
  bindRange('#oSoft', 'soft', '#vSoft', v => v / 100, v => v * 100, v => Math.round(v * 100) + '%');
  bindRange('#oSm', 'sm', '#vSm', v => v / 100, v => v * 100, v => Math.round(v * 100) + '%');
  bindRange('#oLiq', 'liq', '#vLiq', v => v / 100, v => v * 100, v => Math.round(v * 100) + '%');
  $('#oColor').value = S.color; $('#oColor').oninput = e => { S.color = e.target.value; savePrefs(); };
  $$('.seg').forEach(sg => { const k = sg.dataset.key; const sync = () => sg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(S[k])));
    sg.querySelectorAll('button').forEach(b => b.onclick = () => { S[k] = b.dataset.v; sync(); savePrefs(); }); sync(); });
}
function syncMoveUI() {
  const L = act(), img = L && L.type === 'image';
  ['#bFlipH', '#bFlipV', '#bTReset', '#bAsBg', '#oScale', '#oRot'].forEach(s => $(s).disabled = !img);
  if (img) { $('#oScale').value = Math.round(L.s * 100); $('#vScale').textContent = Math.round(L.s * 100) + '%'; const deg = Math.round(((L.rot * 180 / Math.PI + 540) % 360) - 180); $('#oRot').value = deg; $('#vRot').textContent = deg + '°'; }
  else { $('#vScale').textContent = $('#vRot').textContent = '—'; }
}
let sliderMeta = null;
['#oScale', '#oRot'].forEach(s => {
  const el = $(s); el.addEventListener('pointerdown', () => { const L = act(); if (L.type === 'image') sliderMeta = metaOf(L); });
  el.oninput = () => { const L = act(); if (L.type !== 'image') return; if (!sliderMeta) sliderMeta = metaOf(L); if (s === '#oScale') L.s = el.value / 100; else L.rot = el.value * Math.PI / 180; L.dirty = true; syncMoveUI(); req(); };
  el.onchange = () => { const L = act(); if (sliderMeta && L.type === 'image') pushMeta(L, sliderMeta); sliderMeta = null; };
});
function metaOp(fn) { const L = act(); if (L.type !== 'image') return toast('Select a picture layer'); const b = metaOf(L); fn(L); L.dirty = true; pushMeta(L, b); syncMoveUI(); }
$('#bFlipH').onclick = () => metaOp(L => L.fx *= -1);
$('#bFlipV').onclick = () => metaOp(L => L.fy *= -1);
$('#bTReset').onclick = () => metaOp(L => { L.x = W / 2; L.y = H / 2; L.rot = 0; L.fx = L.fy = 1; L.s = Math.min(W * .85 / L.src.width, H * .85 / L.src.height, 2); });
$('#bWarpReset').onclick = () => metaOp(L => { L.mesh = gridMesh(L.src.width, L.src.height); L.warped = false; });
function useLayerAsBg() { const L = act(); if (L.type !== 'image') return toast('Select a picture layer first'); const b = { ...bg }; bg.type = 'image'; bg.img = coverCanvas(layerPixels(L)); pushBg(b); refreshBg(); toast('Background set from picture'); }
$('#bAsBg').onclick = useLayerAsBg; $('#bBgLayer').onclick = useLayerAsBg;

const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['soft-light', 'Soft light'], ['hard-light', 'Hard light'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'], ['lighter', 'Add (light)']];
function refreshLayers() {
  if (!layers.find(l => l.id === activeId)) activeId = layers.length ? layers[layers.length - 1].id : null;
  const list = $('#layerList'); list.innerHTML = '';
  [...layers].reverse().forEach(L => {
    const row = document.createElement('div'); row.className = 'lrow' + (L.id === activeId ? ' act' : ''); row.dataset.id = L.id;
    const th = mk(54, 72); th.getContext('2d').drawImage(layerPixels(L), 0, 0, 54, 72);
    row.innerHTML = `<div class="info"><input type="text" value=""><select>${BLENDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select><input type="range" min="0" max="100"></div>
      <div class="btns"><button data-a="vis" title="Show/hide">${L.visible ? '👁' : '◌'}</button><button data-a="up" title="Move up">▲</button><button data-a="del" title="Delete">🗑</button><button data-a="down" title="Move down">▼</button></div>`;
    row.prepend(th);
    const [name, sel, op] = row.querySelectorAll('input[type=text],select,input[type=range]');
    name.value = (L.type === 'image' ? '🖼 ' : '') + L.name; sel.value = L.blend; op.value = Math.round(L.opacity * 100);
    name.onchange = () => { const b = metaOf(L); L.name = name.value.replace(/^🖼 /, ''); pushMeta(L, b); };
    sel.onchange = () => { const b = metaOf(L); L.blend = sel.value; pushMeta(L, b); req(); };
    let ob = null; op.onpointerdown = () => ob = metaOf(L); op.oninput = () => { if (!ob) ob = metaOf(L); L.opacity = op.value / 100; req(); }; op.onchange = () => { if (ob) pushMeta(L, ob); ob = null; };
    row.onclick = e => { if (e.target.closest('button,select,input')) return; activeId = L.id; refreshLayers(); };
    row.querySelectorAll('button').forEach(b => b.onclick = () => {
      const a = b.dataset.a, i = layers.indexOf(L);
      if (a === 'vis') { const m = metaOf(L); L.visible = !L.visible; pushMeta(L, m); refreshLayers(); return; }
      const before = snapStruct();
      if (a === 'up' && i < layers.length - 1) [layers[i], layers[i + 1]] = [layers[i + 1], layers[i]];
      else if (a === 'down' && i > 0) [layers[i], layers[i - 1]] = [layers[i - 1], layers[i]];
      else if (a === 'del') { if (layers.length === 1) return toast('Keep at least one layer'); layers.splice(i, 1); }
      else return;
      push(structEntry(before)); refreshLayers();
    });
    list.appendChild(row);
  });
  syncMoveUI(); req();
}
function refreshBg() {
  $$('.bgtypes button').forEach(b => b.classList.toggle('on', b.dataset.bg === bg.type));
  $('#bgColor').value = bg.color; $('#bgC1').value = bg.c1; $('#bgC2').value = bg.c2; $('#bgAng').value = bg.angle; req();
}
$$('.bgtypes button').forEach(b => b.onclick = () => { if (b.dataset.bg === 'image' && !bg.img) return $('#fileBg').click(); const o = { ...bg }; bg.type = b.dataset.bg; pushBg(o); refreshBg(); });
[['#bgColor', 'color', 'solid'], ['#bgC1', 'c1', 'gradient'], ['#bgC2', 'c2', 'gradient'], ['#bgAng', 'angle', 'gradient']].forEach(([s, k, t]) => {
  const el = $(s); let b = null; el.oninput = () => { if (!b) b = { ...bg }; bg[k] = k === 'angle' ? +el.value : el.value; bg.type = t; refreshBg(); };
  el.onchange = () => { if (b) pushBg(b); b = null; };
});
$('#bBgPick').onclick = () => $('#fileBg').click();

function openSheet(id) { $$('.sheet').forEach(s => s.classList.toggle('open', s.id === id)); $('#scrim').classList.toggle('on', !!id); if (id === 'layersSheet') refreshLayers(); }
$('#scrim').onclick = () => openSheet(null); $$('.sheet .close').forEach(b => b.onclick = () => openSheet(null));
$('#bLayers').onclick = () => openSheet('layersSheet'); $('#bBg').onclick = () => openSheet('bgSheet'); $('#bImport').onclick = () => openSheet('importSheet');
$('#bAddPic').onclick = () => openSheet('importSheet');
$('#bLib').onclick = () => $('#fileLib').click(); $('#bCam').onclick = () => $('#fileCam').click();
$('#bAddLayer').onclick = () => { const b = snapStruct(); insertAbove(newPaint('Layer ' + uid), act()); push(structEntry(b)); refreshLayers(); };
$('#bUndo').onclick = undo; $('#bRedo').onclick = redo; $('#bFit').onclick = fit; $('#bExport').onclick = () => exportPNG();

async function fileToCanvas(f, max = 1800) {
  let bmp; try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); }
  catch { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(f); }); }
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = mk(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height); return c;
}
async function importFile(f) {
  if (!f) return; try {
    const c = await fileToCanvas(f), b = snapStruct(), L = newImage(c, (f.name || 'Picture').replace(/\.[^.]+$/, '').slice(0, 24));
    insertAbove(L, act()); push(structEntry(b)); refreshLayers(); openSheet(null); setTool('move'); toast('Picture added – drag, pinch or rotate');
  } catch (e) { toast('Could not open that image'); }
}
['#fileLib', '#fileCam'].forEach(s => $(s).onchange = e => { importFile(e.target.files[0]); e.target.value = ''; });
$('#fileBg').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const c = await fileToCanvas(f, 2400), b = { ...bg }; bg.type = 'image'; bg.img = coverCanvas(c); pushBg(b); refreshBg(); };

/* ---------- export ---------- */
const toBlob = c => new Promise(r => c.toBlob(r, 'image/png'));
async function exportPNG() {
  const c = mk(W, H); composite(c.getContext('2d'), bg.type !== 'transparent'); const blob = await toBlob(c);
  const name = 'drawpad-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png', file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && matchMedia('(pointer:coarse)').matches && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'DrawPad' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('PNG saved');
  return blob;
}

/* ---------- autosave (IndexedDB) ---------- */
let dbp; const db = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('drawpad', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
async function kv(mode, k, v) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('kv', mode), s = t.objectStore('kv'), q = mode === 'readonly' ? s.get(k) : s.put(v, k); t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error); }); }
async function blobToCanvas(b) { const bm = await createImageBitmap(b), c = mk(bm.width, bm.height); c.getContext('2d').drawImage(bm, 0, 0); return c; }
let saveT = 0, saving = false, saveAgain = false;
function scheduleSave() { $('#saveState').textContent = '•'; clearTimeout(saveT); saveT = setTimeout(save, 1200); }
async function save() {
  if (saving) { saveAgain = true; return; } saving = true;
  try {
    const doc = { v: 1, uid, activeId, bg: { ...bg, img: bg.img ? await toBlob(bg.img) : null }, layers: [] };
    for (const L of layers) {
      const m = { id: L.id, type: L.type, fx: L.fx, ...metaOf(L) };
      if (L.type === 'paint') { m.fxTag = L.fx; m.canvas = await toBlob(L.canvas); }
      else { m.flipX = L.fx; m.src = await toBlob(L.src); m.mask = L.mask ? await toBlob(L.mask) : null; }
      doc.layers.push(m);
    }
    await kv('readwrite', 'doc', doc); $('#saveState').textContent = 'saved';
  } catch (e) { console.warn(e); $('#saveState').textContent = 'not saved'; }
  saving = false; if (saveAgain) { saveAgain = false; save(); }
}
async function load() {
  const d = await kv('readonly', 'doc').catch(() => null); if (!d || !d.layers || !d.layers.length) return false;
  const out = [];
  for (const m of d.layers) {
    let L;
    if (m.type === 'paint') { L = newPaint(m.name); L.canvas.getContext('2d').drawImage(await blobToCanvas(m.canvas), 0, 0); L.fx = m.fxTag; }
    else { L = newImage(await blobToCanvas(m.src), m.name); Object.assign(L, { x: m.x, y: m.y, s: m.s, rot: m.rot, fx: m.flipX, fy: m.fy, mesh: m.mesh, warped: m.warped }); if (m.mask) L.mask = await blobToCanvas(m.mask); }
    Object.assign(L, { id: m.id, visible: m.visible, opacity: m.opacity, blend: m.blend, dirty: true }); out.push(L);
  }
  layers = out; uid = d.uid; activeId = d.activeId; bg = { ...d.bg, img: d.bg.img ? await blobToCanvas(d.bg.img) : null }; return true;
}
function changed() { $('#bUndo').disabled = !undoS.length; $('#bRedo').disabled = !redoS.length; if ($('#layersSheet').classList.contains('open')) refreshLayers(); req(); scheduleSave(); }
function savePrefs() { try { localStorage.setItem('drawpad-prefs', JSON.stringify({ ...S, tool: undefined })); } catch { } }

/* ---------- boot ---------- */
(async function boot() {
  try { Object.assign(S, JSON.parse(localStorage.getItem('drawpad-prefs') || '{}'), { tool: 'pen' }); } catch { }
  initControls();
  if (!(await load())) { layers = [newPaint('Layer 1')]; activeId = layers[0].id; }
  refreshLayers(); refreshBg(); setTool('pen'); fit(); changed(); $('#saveState').textContent = '';
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => { });
  window.DP = { get layers() { return layers; }, S, setTool, undo, redo, get undoCount() { return undoS.length; }, renderNow, exportPNG, save, get bg() { return bg; }, set active(id) { activeId = id; refreshLayers(); }, vw, fit, openSheet };
})();
