// Attention в 3D: 12 карт внимания (3 слоя × 4 головы) стопкой. Карта — треугольник: строка — токен-запрос, столбец —
// токен, на который он смотрит (только назад, поэтому треугольник, а не квадрат); растущая площадь n(n+1)/2 — это и
// есть квадратичный рост. Пунктир — предел контекста. Выбранная или наведённая карта поднимает строку текущего токена
// рельефом (высота — вес внимания) и подписывает три слова, на которые голова смотрит сильнее всего.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { setBackdrop } from './backdrop.js';
import { t as tx } from './i18n.js';

const SIDE = 3.2;
const GOLD = new THREE.Color(0xffe08a);

function label(text, color = '#8a919c', size = 40, scale = 0.26) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = `${size}px ui-monospace, Menlo, monospace`;
  const w = Math.ceil(g.measureText(text).width) + 16;
  c.width = w; c.height = size + 16;
  g.font = `${size}px ui-monospace, Menlo, monospace`; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 8, c.height / 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(w / c.height * scale, scale, 1);
  return sp;
}

export class AttnStack3D {
  constructor(container, info, onSelect, tokenText) {
    this.box = container; this.info = info; this.onSelect = onSelect; this.tokenText = tokenText || [];
    this.sel = { layer: -1, head: -1 }; this.hover = null; this.explode = 0.25;
    const { layers: L, heads: H, maxPos } = info;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setClearColor(0x111317);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.userMoved = false;
    this.controls.addEventListener('start', () => { this.userMoved = true; });
    // подписи слов рисуются в плоскости экрана поверх 3D: не накладываются при любом повороте камеры
    this.over = document.createElement('canvas');
    Object.assign(this.over.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    container.appendChild(this.over);
    this.callouts = [];
    this.cards = [];
    for (let l = 0; l < L; l++) for (let h = 0; h < H; h++) {
      const cv = document.createElement('canvas'); cv.width = cv.height = maxPos;
      const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false });
      // треугольник: (строка 0, столбец 0) — (строка P, столбец 0) — (строка P, столбец P)
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([-SIDE / 2, 0, -SIDE / 2, -SIDE / 2, 0, SIDE / 2, SIDE / 2, 0, SIDE / 2], 3));
      tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0], 2));
      const mesh = new THREE.Mesh(tri, mat);
      mesh.userData = { layer: l, head: h };
      const edgeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-SIDE / 2, 0, -SIDE / 2),
        new THREE.Vector3(-SIDE / 2, 0, SIDE / 2), new THREE.Vector3(SIDE / 2, 0, SIDE / 2), new THREE.Vector3(-SIDE / 2, 0, -SIDE / 2)]);
      const edge = new THREE.Line(edgeGeo, new THREE.LineDashedMaterial({ color: 0x3a3f48, dashSize: 0.08, gapSize: 0.06 }));
      edge.computeLineDistances();
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(SIDE, 0.025).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      // слева — «слой N» один раз на слой; «голова N» видна только у карты в фокусе (иначе 12 подписей накладываются)
      const tag = label(h === 0 ? tx('a.layer', { n: l + 1 }) : tx('a.head', { n: h + 1 }), h === 0 ? '#c9ced6' : '#8a919c');
      const htag = label(tx('a.head', { n: h + 1 }), '#f2b33d'); htag.visible = false;
      htag.position.set(-SIDE / 2 - 0.15, 0.12, -SIDE / 2 + 0.2); htag.center.set(1, 0);
      const ridge = new THREE.Group();            // рельеф строки текущего токена (только у карты в фокусе)
      const g = new THREE.Group(); g.add(mesh, edge, bar, tag, ridge, htag);
      tag.position.set(-SIDE / 2 - 0.15, 0, -SIDE / 2 + 0.2); tag.center.set(1, 0.5);
      this.scene.add(g);
      this.cards.push({ l, h, cv, ctx: cv.getContext('2d'), tex, mat, mesh, edge, bar, g, tag, ridge, htag });
    }
    // подпись предела контекста у верхней карты
    this.limitTag = label(tx('a.limit', { n: maxPos }), '#5b616b', 36, 0.22);
    this.scene.add(this.limitTag);
    this.layoutCards();
    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.pick(e, false));
    el.addEventListener('pointerleave', () => { this.hover = null; this.style(); });
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) this.pick(e, true); });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.style();                               // подписи голов — только у карты в фокусе, с первого кадра
    const loop = () => { requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); this.drawCallouts(); };
    loop();
  }

  // стопка: слои снизу вверх, внутри слоя — головы; explode раздвигает
  layoutCards() {
    const { heads: H, layers: L } = this.info, gapHead = 0.06 + 0.55 * this.explode, gapLayer = gapHead + 0.15 + 0.9 * this.explode;
    let y = 0, prev = null;
    this.cards.forEach((c, i) => {
      if (i > 0) {
        let gap = c.h === 0 ? gapLayer : gapHead;
        // над выбранной картой — место для рельефа, как у раскрытой папки
        if (prev && this.sel && prev.l === this.sel.layer && prev.h === this.sel.head) gap = Math.max(gap, 1.0);
        y += gap;
      }
      c.g.position.set(0, y, 0); prev = c;
    });
    const dy = this.height === undefined ? 0 : (y - this.height) / 2;
    this.height = y;
    if (this.limitTag) this.limitTag.position.set(SIDE / 2 + 0.1, y, SIDE / 2 + 0.25);
    if (!this.userMoved) this.fit();
    else { this.controls.target.y += dy; this.camera.position.y += dy; }   // ракурс пользователя сохраняется
  }

  setExplode(v) { this.explode = v; this.layoutCards(); this.ridges(); }

  fit() {
    if (!this.height && this.height !== 0) return;
    const c = new THREE.Vector3(0, this.height / 2, 0), r = Math.hypot(SIDE * 0.75, this.height / 2 + 0.6, SIDE * 0.75);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = r / Math.sin(Math.min(vfov, hfov) / 2) * 0.74;   // по умолчанию чуть ближе, но стопка целиком в кадре
    const dir = new THREE.Vector3(0.55, 2.3, 0.95).normalize();
    this.controls.target.copy(c);
    this.camera.position.copy(c).addScaledVector(dir, dist);
    this.camera.near = dist / 50; this.camera.far = dist * 5; this.camera.updateProjectionMatrix();
  }

  resize() {
    const w = this.box.clientWidth, h = this.box.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    // подложка тяжёлая (зерно по пикселям): пересчитываем, когда размер устоялся (анимация сворачивания карточек)
    clearTimeout(this.bdT);
    if (!this.scene.background) setBackdrop(this.scene, w, h, window.devicePixelRatio || 1);
    else this.bdT = setTimeout(() => setBackdrop(this.scene, w, h, window.devicePixelRatio || 1), 160);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.fit();
  }

  pick(e, click) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObjects(this.cards.map((c) => c.mesh))[0];
    const hv = hit ? hit.object.userData : null;
    if (click) {
      if (hv) {
        this.sel = (hv.layer === this.sel.layer && hv.head === this.sel.head) ? { layer: -1, head: -1 } : { ...hv };
        this.layoutCards();
        if (this.onSelect) this.onSelect(this.sel);
      }
    }
    const changed = (hv && (!this.hover || hv.layer !== this.hover.layer || hv.head !== this.hover.head)) || (!hv && this.hover);
    this.hover = hv; this.style();
    if (changed || click) this.ridges();
  }

  // рельеф строки текущего токена у карты в фокусе: высота пика — вес внимания на этот токен; подписи трёх сильнейших
  ridges() {
    for (const c of this.cards) c.ridge.clear();
    this.callouts = [];
    const f = this.hover || (this.sel.layer >= 0 ? this.sel : null);
    if (!f || !this.steps) return;
    const c = this.cards.find((x) => x.l === f.layer && x.h === f.head), { heads: H, maxPos: P } = this.info;
    const st = this.steps[this.cur], n = st.pos + 1;
    // веса по режиму редактора: «куда смотрит» или «вклад» (если редактор дал функцию), иначе — веса внимания
    const w = this.weightsFn ? this.weightsFn(f) : st.attnP.subarray((c.l * H + c.h) * n, (c.l * H + c.h + 1) * n);
    const contrib = this.mode === 'contrib', color = contrib ? 0xa98cf0 : 0xf2b33d, css = contrib ? '#c3b0f6' : '#ffe08a';
    let mx = 1e-9; for (const v of w) mx = Math.max(mx, v);
    // высота — не больше 90% зазора до карты выше: рельеф не пробивает соседние карты при любом раздвижении
    const above = this.cards.map((x) => x.g.position.y).filter((y) => y > c.g.position.y + 1e-6);
    const gap = above.length ? Math.min(...above) - c.g.position.y : 1.1;
    const z = -SIDE / 2 + (this.cur + 0.5) / P * SIDE, HMAX = 0.9 * gap - 0.08, pts = [], top = [];
    for (let t = 0; t < n; t++) {
      const x = -SIDE / 2 + (t + 0.5) / P * SIDE, y = HMAX * w[t] / mx;
      pts.push(new THREE.Vector3(x, 0.01, z), new THREE.Vector3(x, 0.01 + y, z));
      top.push([t, w[t]]);
    }
    c.ridge.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })));
    // подписи — в плоскости экрана (drawCallouts): точки пиков в 3D, текст и выноски рисуются поверх
    top.sort((a, b) => b[1] - a[1]);
    this.calloutCard = c;
    this.callouts = top.slice(0, 3).map(([t, v]) => ({
      p: new THREE.Vector3(-SIDE / 2 + (t + 0.5) / P * SIDE, 0.01 + HMAX * v / mx, z),
      text: `${(this.tokenText[this.steps[t].input] || '').replace(/\n/g, '↵').trim() || '·'} ${(100 * v).toFixed(0)}%`, color: css,
    }));
  }

  // выноски в экранных координатах: подписи столбиком справа от выбранной карты, раздвинуты не меньше чем на 18 px
  drawCallouts() {
    const cv = this.over, dpr = window.devicePixelRatio || 1, W = this.box.clientWidth, H = this.box.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (!this.callouts.length || !this.calloutCard || !this.calloutCard.ridge.children.length) return;
    const proj = (v) => { const q = v.clone().applyMatrix4(this.calloutCard.g.matrixWorld).project(this.camera); return [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H]; };
    // правый край карты на экране
    let xr = -Infinity;
    for (const [x, z] of [[-SIDE / 2, -SIDE / 2], [SIDE / 2, SIDE / 2], [-SIDE / 2, SIDE / 2], [SIDE / 2, -SIDE / 2]]) xr = Math.max(xr, proj(new THREE.Vector3(x, 0, z))[0]);
    const pts = this.callouts.map((c) => ({ ...c, s: proj(c.p) })).sort((a, b) => a.s[1] - b.s[1]);
    const lx = Math.min(W - 120, xr + 24);
    let y = -Infinity;
    for (const c of pts) { c.ly = Math.max(c.s[1], y + 18); y = c.ly; }
    g.font = '12px ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
    for (const c of pts) {
      g.strokeStyle = c.color; g.globalAlpha = 0.55; g.lineWidth = 1;
      g.beginPath(); g.moveTo(c.s[0], c.s[1]); g.lineTo(lx - 6, c.ly); g.stroke();
      g.globalAlpha = 1; g.fillStyle = 'rgba(17,19,23,0.75)';
      const w = g.measureText(c.text).width; g.fillRect(lx - 2, c.ly - 8, w + 6, 16);
      g.fillStyle = c.color; g.fillText(c.text, lx + 1, c.ly);
    }
  }

  describe() {
    const f = this.sel.layer >= 0 ? this.sel : null;
    if (!f || !this.steps) return '';
    const { heads: H } = this.info, st = this.steps[this.cur], n = st.pos + 1;
    const w = st.attnP.subarray((f.layer * H + f.head) * n, (f.layer * H + f.head + 1) * n);
    const top = Array.from(w.keys()).sort((a, b) => w[b] - w[a]).slice(0, 6);
    const ent = -Array.from(w).reduce((s, p) => s + (p > 0 ? p * Math.log2(p) : 0), 0);
    const list = top.map((t) => `<span class="tokpill">${(this.tokenText[this.steps[t].input] || '').replace(/\n/g, '↵').replace(/ /g, '·')}</span> ${(100 * w[t]).toFixed(0)}%`).join(' ');
    return `<h4>${tx('a.desc.head', { layer: f.layer + 1, head: f.head + 1 })}</h4><div class="note">${tx('a.desc.looks', { list })}</div>
      <div class="note">${tx('a.desc.entropy', { x: ent.toFixed(1), max: Math.log2(n).toFixed(1) })}</div>`;
  }

  setSel(sel) { this.sel = { ...sel }; this.layoutCards(); this.style(); this.ridges(); }

  style() {
    const focus = this.hover || (this.sel.layer >= 0 ? this.sel : null);
    for (const c of this.cards) {
      const on = !focus || (focus.layer === c.l && focus.head === c.h);
      const sel = this.sel.layer === c.l && this.sel.head === c.h;
      c.mat.opacity = on ? 0.95 : 0.18;
      c.edge.material.color.set(sel ? 0xf2b33d : on && focus ? 0x8a919c : 0x3a3f48);
      c.tag.visible = c.h === 0;
      c.tag.material.opacity = on ? 1 : 0.4;
      c.htag.visible = !!focus && focus.layer === c.l && focus.head === c.h;
    }
  }

  // карты до текущего шага: n×n, нижний треугольник — веса внимания (корень для читаемости)
  set(steps, cur) {
    this.steps = steps; this.cur = cur;
    const { heads: H, maxPos: P } = this.info, n = cur + 1;
    for (const c of this.cards) {
      const img = c.ctx.createImageData(P, P), d = img.data;
      for (let s = 0; s < n; s++) {
        const st = steps[s], w = st.attnP.subarray((c.l * H + c.h) * (st.pos + 1), (c.l * H + c.h + 1) * (st.pos + 1));
        for (let t = 0; t <= s; t++) {
          const v = Math.min(1, Math.sqrt(w[t]) * 2.2), o = (s * P + t) * 4;   // жёлтый по силе внимания
          d[o] = 58 + 184 * v; d[o + 1] = 54 + 125 * v; d[o + 2] = 50 + 11 * v; d[o + 3] = 255;
        }
        for (let t = s + 1; t < n; t++) { const o = (s * P + t) * 4; d[o] = 26; d[o + 1] = 28; d[o + 2] = 33; d[o + 3] = 200; }
      }
      c.ctx.clearRect(0, 0, P, P);
      c.ctx.putImageData(img, 0, 0);
      c.tex.needsUpdate = true;
      // карта растёт из угла: текстура P×P, заполнены первые n строк и столбцов
      c.bar.position.set(0, 0.01, -SIDE / 2 + (cur + 0.5) / P * SIDE);
      c.bar.scale.set((cur + 1) / P, 1, 1);
      c.bar.position.x = -SIDE / 2 + (cur + 1) / P * SIDE / 2;
    }
    this.style();
    this.ridges();
  }
}
