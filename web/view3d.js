// 3D-вид модели (Three.js): «бутерброд» из вертикальных пластин поперёк потока, слева направо:
//   поток (эмбеддинг) → головы attention → поток после attention → нейроны MLP → поток после слоя → … → выход.
// Каждое число — светящаяся точка: цвет — знак (оранжевый > 0, голубой < 0), яркость — величина (нормировка по вектору).
// Линии — реальный поток для текущего токена, только самые сильные связи, прямо сквозь пластины:
//   магистраль: сильнейшие измерения остаточного потока насквозь через все слои;
//   attention: голова h пишет в измерение i вклад (W_o · выход головы)_i;
//   MLP: нейрон j пишет в измерение i вклад W_down[i, j] · активация_j.
// При смене токена импульс бежит слева направо.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { setBackdrop } from './backdrop.js';
import { t as tx } from './i18n.js';

// палитра из двух комплементарных цветов: жёлтый (плюс, путь к выбранному токену) — сиреневый (минус, attention)
const POS = new THREE.Color(0xf2b33d), NEG = new THREE.Color(0xa98cf0), DIM = new THREE.Color(0x4b4f56);
const GREY = new THREE.Color(0x5d636d);          // слабые значения: видимая сетка, как пустые клетки в attention
const S = 0.24;                                    // шаг сетки точек
const LAYER_DX = 5.2, X_HEADS = 1.25, X_MID = 2.4, X_MLP = 3.8;
const N_HIGHWAY = 8, N_NEURONS = 10, PER_NEURON = 2, PER_HEAD = 2;   // линий немного: только сильнейшие пути
const GLASS = 0x9fb3d6, RIM = 0x6f7b8c, GLASS_T = 0.07, GLASS_PAD = 0.12;   // стекло пластин
const SEL_GAP = 2.4;                 // у выбранной пластины соседи не ближе — место для столбиков рельефа

let glowTex = null;
function glow() {                                  // круглая мягкая точка
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  r.addColorStop(0.55, 'rgba(255,255,255,0.25)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

// точки со своим размером: размер в мировых единицах (с перспективой), мягкий круг, сложение света
let pointMat = null;
function pointMaterial() {
  if (pointMat) return pointMat;
  pointMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: glow() }, scale: { value: 600 } },
    vertexShader: `attribute float psize; varying vec3 vColor;
      uniform float scale;
      void main() { vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = psize * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vColor;
      void main() { float a = texture2D(map, gl_PointCoord).a; gl_FragColor = vec4(vColor * a, a); }`,
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return pointMat;
}

function label(text, color = '#d8dce2', size = 44, scale = 0.34) {
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

// пластина одного вектора в плоскости YZ при данном x: плитки cols — по z, rows — по y.
// Цвет — знак (оранжевый > 0, голубой < 0); насыщенность и непрозрачность — величина. Без свечения: плитка не
// выходит за свою клетку, поэтому расположение в сетке всегда читается.
let tileMat = null;
function tileMaterial() {
  if (tileMat) return tileMat;
  tileMat = new THREE.ShaderMaterial({
    vertexShader: `attribute float ialpha; varying vec3 vColor; varying float vAlpha; varying vec2 vUv;
      void main() { vColor = instanceColor; vAlpha = ialpha; vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    // цвета Three.js хранятся в линейном пространстве: на выходе переводим в sRGB, как стандартные материалы
    // (иначе плитки темнее и другого оттенка, чем столбики рельефа)
    // плитка — скруглённый квадрат (сглаживание через fwidth) с мягким бликом к верхнему краю, как стеклянная мозаика
    fragmentShader: `varying vec3 vColor; varying float vAlpha; varying vec2 vUv;
      void main() {
        vec2 q = abs(vUv - 0.5) - (0.5 - 0.2); float d = length(max(q, 0.0)) - 0.2;
        float aa = max(fwidth(d), 1e-4), m = 1.0 - smoothstep(-aa, aa, d);
        if (m < 0.01) discard;
        vec3 col = vColor * (0.82 + 0.36 * vUv.y);
        gl_FragColor = vec4(col, vAlpha * m);
      #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  return tileMat;
}

class Plate {
  constructor(n, cols, x, tile = 1) {
    this.n = n; this.cols = cols; this.rows = Math.ceil(n / cols); this.x = x;
    const side = S * 0.84 * tile;
    const geo = new THREE.PlaneGeometry(side, side); geo.rotateY(Math.PI / 2);   // плитка в плоскости YZ
    this.alpha = new Float32Array(n);
    geo.setAttribute('ialpha', new THREE.InstancedBufferAttribute(this.alpha, 1));
    this.mesh = new THREE.InstancedMesh(geo, tileMaterial(), n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { const [y, z] = this.local(i); m.makeTranslation(x, y, z); this.mesh.setMatrixAt(i, m); }
    this.mesh.setColorAt(0, new THREE.Color());
    this.points = this.mesh;                       // совместимость: сцена добавляет p.points
    this.cur = new Float32Array(n); this.from = new Float32Array(n); this.to = new Float32Array(n);
    this.c = new THREE.Color();
    const h = this.rows * S * (tile > 1 ? tile : 1), w = this.cols * S * (tile > 1 ? tile : 1);
    // стеклянная пластина под плитками (как карточки attention): тонкий полупрозрачный слой с толщиной,
    // светлая кромка по рёбрам; у выбранной кромка янтарная
    const slab = new THREE.BoxGeometry(GLASS_T, h + GLASS_PAD * 2, w + GLASS_PAD * 2);
    this.glass = new THREE.Mesh(slab, new THREE.MeshBasicMaterial({ color: GLASS, transparent: true, opacity: 0.075, depthWrite: false }));
    this.glass.position.x = x; this.glass.renderOrder = -1;
    this.frame = new THREE.LineSegments(new THREE.EdgesGeometry(slab),
      new THREE.LineBasicMaterial({ color: RIM, transparent: true, opacity: 0.55, depthWrite: false }));
    this.frame.position.x = x;
    this.height = h; this.width = w; this.tile = tile;
    this.apply(1);
  }
  setX(x) {
    this.x = x;
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.n; i++) { const [y, z] = this.local(i); m.makeTranslation(x, y, z); this.mesh.setMatrixAt(i, m); }
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.computeBoundingSphere();
    this.frame.position.x = x; this.glass.position.x = x;
  }
  local(i) {
    const st = S * (this.tile > 1 ? this.tile : 1);
    return [(this.rows - 1) / 2 * st - Math.floor(i / this.cols) * st, ((i % this.cols) - (this.cols - 1) / 2) * st];
  }
  at(i) { const [y, z] = this.local(i); return new THREE.Vector3(this.x, y, z); }
  target(v) {
    let mx = 1e-9; for (const x of v) mx = Math.max(mx, Math.abs(x));
    this.from.set(this.cur);
    for (let i = 0; i < this.n; i++) this.to[i] = v[i] / mx;
  }
  apply(t) {
    for (let i = 0; i < this.n; i++) {
      const v = this.from[i] + (this.to[i] - this.from[i]) * t; this.cur[i] = v;
      // тот же оттенок, что у столбиков рельефа: (POS|NEG)·(0.45 + 0.55·a); слабые — заметный нейтральный серый
      const a = Math.min(1, Math.abs(v));
      this.c.copy(v >= 0 ? POS : NEG).multiplyScalar(0.45 + 0.55 * a);
      this.c.lerpColors(GREY, this.c, Math.min(1, a * 2.2));
      this.mesh.setColorAt(i, this.c);
      this.alpha[i] = 0.32 + 0.66 * a ** 0.8;
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.geometry.getAttribute('ialpha').needsUpdate = true;
  }
}

// светящиеся линии, которые проявляются слева направо вместе с импульсом
class Wires {
  constructor(scene) {
    this.geo = new THREE.BufferGeometry();
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    this.obj = new THREE.LineSegments(this.geo, this.mat); scene.add(this.obj);
    this.clear();
  }
  clear() { this.pts = []; this.cols = []; }
  seg(a, b, color, alpha, n = 6, tags = null) {  // прямая (разбита на куски, чтобы проявлялась постепенно)
    if (this.focus) alpha *= tags && tags.includes(this.focus) ? 0.15 : 0.4;   // при выборе акцент на рельефе
    for (let i = 0; i < n; i++) {
      this.pts.push(a.clone().lerp(b, i / n), a.clone().lerp(b, (i + 1) / n));
      for (let k = 0; k < 2; k++) this.cols.push(color.r * alpha, color.g * alpha, color.b * alpha);
    }
  }
  commit() {
    // новая геометрия на каждый шаг: setFromPoints в r170 переиспользует старый буфер и падает, если точек стало меньше
    this.geo.dispose();
    this.geo = new THREE.BufferGeometry().setFromPoints(this.pts);
    this.geo.computeBoundingSphere();          // иначе Three.js отсекает линии по устаревшей сфере
    this.obj.geometry = this.geo;
    this.base = new Float32Array(this.cols);
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.cols), 3));
    this.xs = this.pts.map((p) => p.x);
  }
  reveal(front) {
    const c = this.geo.getAttribute('color');
    if (!c) return;
    for (let v = 0; v < this.xs.length; v++) {
      const k = Math.max(0, Math.min(1, (front - this.xs[v]) / 1.2));
      c.array[v * 3] = this.base[v * 3] * k; c.array[v * 3 + 1] = this.base[v * 3 + 1] * k; c.array[v * 3 + 2] = this.base[v * 3 + 2] * k;
    }
    c.needsUpdate = true;
  }
}

export class View3D {
  constructor(container, engine) {
    this.box = container; this.e = engine;
    const { layers: L, dim: d, inter: I, heads: H } = engine.info;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setClearColor(0x111317);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.userMoved = false;                      // камеру двигали мышью — тогда раздвижение и ресайз её не сбрасывают
    this.controls.addEventListener('start', () => { this.userMoved = true; });

    this.res = [new Plate(d, 8, 0)];              // эмбеддинг = поток перед слоем 1
    this.heads = []; this.mid = []; this.mlp = [];
    for (let l = 0; l < L; l++) {
      const x0 = l * LAYER_DX;
      this.heads.push(new Plate(H, 1, x0 + X_HEADS, 2.2));
      this.mid.push(new Plate(d, 8, x0 + X_MID));
      this.mlp.push(new Plate(I, 16, x0 + X_MLP, 1));
      this.res.push(new Plate(d, 8, x0 + LAYER_DX));
      const t = label(tx('m.layer', { n: l + 1 }), '#f0b37a', 52, 0.5); t.position.set(x0 + LAYER_DX / 2, 3.1, 0); this.scene.add(t);
    }
    this.res.forEach((p, l) => Object.assign(p, { tag: 'res' + l, kind: 'resid', layer: l, name: l === 0 ? tx('m.embedding') : tx('m.resAfter', { n: l }) }));
    this.mid.forEach((p, l) => Object.assign(p, { tag: 'mid' + l, kind: 'mid', layer: l, name: tx('m.midAfter', { n: l + 1 }) }));
    this.heads.forEach((p, l) => Object.assign(p, { tag: 'heads' + l, kind: 'heads', layer: l, name: tx('m.headsOf', { n: l + 1 }) }));
    this.mlp.forEach((p, l) => Object.assign(p, { tag: 'mlp' + l, kind: 'mlp', layer: l, name: tx('m.mlpOf', { n: l + 1 }) }));
    this.plates = [...this.res, ...this.heads, ...this.mid, ...this.mlp];
    for (const p of this.plates) { this.scene.add(p.points); this.scene.add(p.glass, p.frame); }
    const sub = (p, t, c = '#6b7280') => { const s = label(t, c, 38, 0.28); s.position.set(p.x, -p.height / 2 - 0.35, 0); this.scene.add(s); };
    sub(this.res[0], tx('m.embedding'), '#8a919c');
    for (let l = 0; l < L; l++) { sub(this.heads[l], tx('m.sub.heads'), '#b79cff'); sub(this.mlp[l], `MLP · ${I}`); sub(this.res[l + 1], tx('m.sub.stream')); sub(this.mid[l], '+ attention'); }
    // базовые x для ползунка «раздвинуть»: пластины и подписи
    this.spread = 1;
    for (const p of this.plates) p.bx = p.x;
    this.xl = this.scene.children.filter((o) => o.isSprite).map((o) => ({ o, bx: o.position.x }));
    this.wires = new Wires(this.scene);
    this.sel = null; this.hov = null; this.onSelect = null;
    this.peaks = new THREE.Group(); this.scene.add(this.peaks);
    const ring = new THREE.EdgesGeometry(new THREE.PlaneGeometry(S * 1.15, S * 1.15).rotateY(Math.PI / 2));
    this.cursor = new THREE.LineSegments(ring, new THREE.LineBasicMaterial({ color: 0xffe08a })); this.cursor.visible = false;
    this.scene.add(this.cursor);
    this.tip = label(' ', '#ffe08a', 40, 0.3); this.tip.visible = false; this.tip.center.set(0, 0); this.scene.add(this.tip);
    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointermove', (e) => this.pick(e, false));
    el.addEventListener('pointerleave', () => { this.cursor.visible = false; this.tip.visible = false; this.hov = null; });
    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) this.pick(e, true); });
    this.baseOutX = L * LAYER_DX + 1.8; this.outX = this.baseOutX;
    this.out = new THREE.Group(); this.scene.add(this.out);
    this.inLabel = null;
    this.pulse = 1; this.dur = 600;
    new ResizeObserver(() => this.resize()).observe(container);
    this.preset('perspective', false);
    this.resize();
    const loop = () => { requestAnimationFrame(loop); this.tick(); };
    loop();
  }

  pick(e, click) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObjects(this.plates.map((p) => p.mesh))[0];
    const plate = hit ? this.plates.find((p) => p.mesh === hit.object) : null, idx = hit ? hit.instanceId : -1;
    if (plate && idx >= 0 && this.step) {
      this.cursor.position.copy(plate.at(idx)); this.cursor.scale.setScalar(plate.tile > 1 ? plate.tile : 1); this.cursor.visible = true;
      this.setTip(plate, idx);
    } else { this.cursor.visible = false; this.tip.visible = false; }
    if (click) {
      this.sel = plate ? { plate, idx } : null;
      this.wires.focus = plate ? plate.tag : null;
      for (const p of this.plates) {
        const on = p === plate;
        p.frame.material.color.set(on ? 0xf2b33d : RIM); p.frame.material.opacity = on ? 1 : 0.55;
        p.glass.material.color.set(on ? 0xf2c46a : GLASS); p.glass.material.opacity = on ? 0.1 : 0.075;
      }
      this.layout(true);
      if (this.onSelect) this.onSelect();
    }
  }

  // рельеф выбранной пластины: столбик из каждой плитки перпендикулярно пластине — плюс (жёлтый) влево,
  // минус (сиреневый) вправо, длина — значение (нормировка по вектору); подписи у трёх самых длинных
  buildPeaks() {
    for (const o of this.peaks.children) { o.geometry && o.geometry.dispose(); }
    this.peaks.clear();
    if (!this.sel || !this.step) return;
    const p = this.sel.plate, w = S * 0.55 * (p.tile > 1 ? p.tile * 0.7 : 1);
    const xs = this.plates.map((q) => q.x).sort((a, b) => a - b), k = xs.indexOf(p.x);
    const gapL = k > 0 ? p.x - xs[k - 1] : SEL_GAP, gapR = k < xs.length - 1 ? xs[k + 1] - p.x : this.outX - p.x - 0.3;
    const LENL = 0.9 * gapL, LENR = 0.9 * gapR;          // плюс — влево, минус — вправо: не дальше соседа
    const geo = new THREE.BoxGeometry(1, w, w); geo.translate(0.5, 0, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }), p.n);
    const m = new THREE.Matrix4(), c = new THREE.Color(), order = [];
    for (let i = 0; i < p.n; i++) {
      const v = p.to[i], len = Math.max(0.004, (v >= 0 ? LENL : LENR) * Math.abs(v)), at = p.at(i);
      m.makeScale(v >= 0 ? -len : len, 1, 1); m.setPosition(at.x, at.y, at.z);
      mesh.setMatrixAt(i, m);
      c.copy(v >= 0 ? POS : NEG).multiplyScalar(0.45 + 0.55 * Math.min(1, Math.abs(v)));
      mesh.setColorAt(i, c);
      order.push(i);
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    this.peaks.add(mesh);
    // подписи трёх самых длинных столбиков — столбиком над пластиной, с выносками от концов столбиков
    // (как в attention): концы соседних столбиков бывают рядом, и подписи у них накладывались бы
    order.sort((a, b) => Math.abs(p.to[b]) - Math.abs(p.to[a]));
    const picks = order.slice(0, 3).sort((a, b) => a - b);
    const name = tx(p.kind === 'mlp' ? 'm.neuron' : p.kind === 'heads' ? 'm.head' : 'm.number');
    const lead = [], leadCol = [];
    picks.forEach((i, k) => {
      const v = this.value(p, i), at = p.at(i), len = (p.to[i] >= 0 ? LENL : LENR) * Math.abs(p.to[i]);
      const tip = new THREE.Vector3(at.x + (p.to[i] >= 0 ? -len : len), at.y, at.z);
      // выше заголовка «слой N» (он на высоте 3.1), чтобы не наезжать на него
      const ly = Math.max(p.height / 2 + 0.35, 3.6) + (picks.length - 1 - k) * 0.36, anchor = new THREE.Vector3(p.x, ly, at.z * 0.3);
      const s = label(`${name} ${p.kind === 'heads' ? i + 1 : i}: ${v >= 0 ? '+' : ''}${v.toFixed(2)}`, v >= 0 ? '#f2b33d' : '#a98cf0', 44, 0.34);
      s.position.copy(anchor).add(new THREE.Vector3(0, 0.02, 0)); s.center.set(0.5, 0);
      this.peaks.add(s);
      const col = (v >= 0 ? POS : NEG);
      lead.push(tip, anchor); leadCol.push(col.r, col.g, col.b, col.r, col.g, col.b);
    });
    const lg = new THREE.BufferGeometry().setFromPoints(lead);
    lg.setAttribute('color', new THREE.Float32BufferAttribute(leadCol, 3));
    this.peaks.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6 })));
  }

  // раздвинуть пластины вдоль потока (размер плиток не меняется)
  setSpread(k) {
    this.spread = k;
    const oldCx = (this.outX + 4.5) / 2 - 2.2;
    this.layout(false);
    if (!this.userMoved) this.preset(this.view || 'perspective', false);
    else {                                       // ракурс пользователя сохраняется: сдвигаем камеру вместе с центром сцены
      const dx = (this.outX + 4.5) / 2 - 2.2 - oldCx;
      this.camera.position.x += dx; this.controls.target.x += dx;
    }
  }

  // где стоят пластины: база × «раздвинуть», а у выбранной пластины соседи отодвинуты до SEL_GAP с каждой стороны
  // (как карточки в attention: выбор открывает место для рельефа при любом положении ползунка)
  targets() {
    const k = this.spread, out = this.baseOutX * k;
    let pushL = 0, pushR = 0, sx = null;
    if (this.sel) {
      sx = this.sel.plate.bx * k;
      const xs = this.plates.map((q) => q.bx * k);
      const left = xs.filter((x) => x < sx - 1e-6), right = [...xs.filter((x) => x > sx + 1e-6), out];
      if (left.length) pushL = Math.max(0, SEL_GAP - (sx - Math.max(...left)));
      pushR = Math.max(0, SEL_GAP - (Math.min(...right) - sx));
    }
    const at = (bx) => { const x = bx * k; return sx === null ? x : x < sx - 1e-6 ? x - pushL : x > sx + 1e-6 ? x + pushR : x; };
    return { plates: this.plates.map((p) => at(p.bx)), sprites: this.xl.map(({ bx }) => at(bx)), out: out + pushR };
  }

  layout(animate) {
    const to = this.targets();
    const from = { plates: this.plates.map((p) => p.x), sprites: this.xl.map(({ o }) => o.position.x), out: this.outX };
    if (!animate) { this.lay = null; this.placeAt(from, to, 1); this.layoutDone(); return; }
    this.lay = { from, to, t0: performance.now() };
    this.wires.obj.visible = false; this.peaks.visible = false; this.out.visible = false;   // вернутся после сдвига
  }
  placeAt(from, to, e) {
    const L = (a, b) => a + (b - a) * e;
    this.plates.forEach((p, i) => p.setX(L(from.plates[i], to.plates[i])));
    this.xl.forEach(({ o }, i) => { o.position.x = L(from.sprites[i], to.sprites[i]); });
    this.outX = L(from.out, to.out);
  }
  layoutDone() {
    this.wires.obj.visible = this.wiresOn !== false; this.peaks.visible = true;
    if (this.step) this.set(this.step, false, this.dur); else this.buildPeaks();
  }
  showWires(on) { this.wiresOn = on; this.wires.obj.visible = on && !this.lay; }

  // короткая подпись у плитки под курсором
  setTip(plate, i) {
    const v = this.value(plate, i), name = `${tx(plate.kind === 'mlp' ? 'm.neuron' : plate.kind === 'heads' ? 'm.head' : 'm.number')} ${plate.kind === 'heads' ? i + 1 : i}`;
    let t = `${name}: ${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
    if (plate.kind === 'mlp') t += ` → ${this.push(plate.layer, i, 3).map((x) => x.w).join(', ')}`;
    this.scene.remove(this.tip);
    this.tip = label(t, '#ffe08a', 40, 0.3); this.tip.center.set(0, 0);
    this.tip.position.copy(plate.at(i)).add(new THREE.Vector3(0, 0.25, 0)); this.scene.add(this.tip);
  }

  value(plate, i) {
    const { dim: d, inter: I, heads: H, headDim: hd } = this.e.info, st = this.step, l = plate.layer;
    if (plate.kind === 'resid') return st.resid[l * d + i];
    if (plate.kind === 'mid') return st.resid[l * d + i] + st.attnOut[l * d + i];
    if (plate.kind === 'mlp') return st.mlpAct[l * I + i];
    let s = 0; for (let j = 0; j < hd; j++) { const x = st.headOut[(l * H + i) * hd + j]; s += x * x; } return Math.sqrt(s);
  }

  // слова, которые вектор «толкает» вверх (logit lens): топ-k
  lensTop(vec, k) {
    const lg = this.e.lens(vec), idx = Array.from(lg.keys()).sort((a, b) => lg[b] - lg[a]).slice(0, k);
    let mx = -Infinity; for (const x of lg) mx = Math.max(mx, x);
    let z = 0; for (const x of lg) z += Math.exp(x - mx);
    return idx.map((t) => ({ t, w: show(this.e.tokenText[t]).replace(/^·/, ''), p: Math.exp(lg[t] - mx) / z }));
  }
  push(l, j, k) {                                   // нейрон j: его вклад W_down[:, j] · активация
    const { dim: d, inter: I } = this.e.info, Wd = this.e.weights(l, 'down'), a = this.step.mlpAct[l * I + j], v = new Float32Array(d);
    for (let i = 0; i < d; i++) v[i] = Wd[i * I + j] * a;
    return this.lensTop(v, k);
  }

  // описание выбранного для инспектора (HTML)
  describe() {
    if (!this.sel || !this.step) return '';
    const { plate, idx } = this.sel, { dim: d, inter: I, heads: H, headDim: hd } = this.e.info, st = this.step, l = plate.layer;
    const pill = (w) => `<span class="tokpill">${w}</span>`, pct = (p) => (100 * p).toFixed(0) + '%';
    let h = `<h4>${tx('m.selected', { name: plate.name })}</h4>`;
    if (plate.kind === 'resid' || plate.kind === 'mid') {
      const v = new Float32Array(d);
      for (let i = 0; i < d; i++) v[i] = plate.kind === 'resid' ? st.resid[l * d + i] : st.resid[l * d + i] + st.attnOut[l * d + i];
      h += `<div class="note">${tx('m.lens')}</div><div class="note">${this.lensTop(v, 5).map((x) => pill(x.w) + ' ' + pct(x.p)).join(' ')}</div>`;
      h += `<div class="note">${tx('m.value', { i: idx, v: v[idx].toFixed(3) })}</div>`;
    } else if (plate.kind === 'mlp') {
      const a = st.mlpAct.subarray(l * I, (l + 1) * I), order = Array.from(a.keys()).sort((x, y) => Math.abs(a[y]) - Math.abs(a[x]));
      const active = a.filter((x) => Math.abs(x) > 0.1 * Math.abs(a[order[0]])).length;
      h += `<div class="note">${tx('m.active', { active, total: I })}</div>`;
      for (const j of [idx, ...order.filter((j) => j !== idx).slice(0, 4)]) {
        h += `<div class="note">${tx('m.neuronLine', { mark: j === idx ? '▸ ' : '', j, a: (a[j] >= 0 ? '+' : '') + a[j].toFixed(2), list: this.push(l, j, 3).map((x) => pill(x.w)).join(' ') })}</div>`;
      }
    } else {
      const Wo = this.e.weights(l, 'o'), n = st.pos + 1;
      for (let hh = 0; hh < H; hh++) {
        const w = st.attnP.subarray((l * H + hh) * n, (l * H + hh + 1) * n);
        const look = Array.from(w.keys()).sort((a, b) => w[b] - w[a]).slice(0, 3);
        const c = new Float32Array(d);
        for (let i = 0; i < d; i++) { let s = 0; for (let j = 0; j < hd; j++) s += Wo[i * H * hd + hh * hd + j] * st.headOut[(l * H + hh) * hd + j]; c[i] = s; }
        h += `<div class="note">${tx('m.headLine', { mark: hh === idx ? '▸ ' : '', h: hh + 1, look: look.map((t) => pill(show(this.e.tokenText[this.steps[t].input])) + ' ' + pct(w[t])).join(' '), list: this.lensTop(c, 3).map((x) => pill(x.w)).join(' ') })}</div>`;
      }
    }
    return h + `<div class="note" style="color:var(--dim)">${tx('m.dimNote')}</div>`;
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
    if (!this.userMoved) this.preset(this.view || 'perspective', false);
  }

  // ракурсы: перспектива, сбоку (пластины ребром — как схема нейросети), вдоль потока
  preset(name, animate = true) {
    this.view = name;
    if (animate) this.userMoved = false;         // кнопка ракурса — явный сброс камеры
    const span = this.outX + 4.5, cx = span / 2 - 2.2;   // outX растёт вместе с «раздвинуть»
    const target = new THREE.Vector3(cx, 0, 0);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const fitW = (span / 2) / Math.tan(hfov / 2), fitH = 3.6 / Math.tan(vfov / 2);
    let dir, dist, tgt = target;
    if (name === 'side') { dir = new THREE.Vector3(0, 0.05, 1); dist = Math.max(fitW, fitH); }
    else if (name === 'along') { dir = new THREE.Vector3(-1, 0.32, 0.42); tgt = new THREE.Vector3(cx * 0.85, 0, 0); dist = span * 0.95; }
    else { dir = new THREE.Vector3(-0.62, 0.36, 0.78); tgt = new THREE.Vector3(cx, 0, 0); dist = span * 1.05; }
    dir.normalize();
    const pos = tgt.clone().addScaledVector(dir, dist);
    this.camera.near = dist / 80; this.camera.far = dist * 6; this.camera.updateProjectionMatrix();
    if (!animate) { this.camera.position.copy(pos); this.controls.target.copy(tgt); return; }
    this.camFrom = { p: this.camera.position.clone(), t: this.controls.target.clone() };
    this.camTo = { p: pos, t: tgt }; this.camT0 = performance.now();
  }

  set(step, animate = true, dur = 600, steps = null) {
    if (!step) return;
    this.step = step; if (steps) this.steps = steps;
    this.dur = dur;
    const { layers: L, dim: d, inter: I, heads: H, headDim: hd } = this.e.info;
    for (let l = 0; l <= L; l++) this.res[l].target(step.resid.subarray(l * d, (l + 1) * d));
    // головы: яркость — норма выхода головы (общая нормировка по всем слоям)
    const hn = new Float32Array(L * H);
    for (let l = 0; l < L; l++) for (let h = 0; h < H; h++) {
      let s = 0; for (let j = 0; j < hd; j++) { const x = step.headOut[(l * H + h) * hd + j]; s += x * x; }
      hn[l * H + h] = Math.sqrt(s);
    }
    const hmax = Math.max(...hn, 1e-9);
    for (let l = 0; l < L; l++) {
      const v = new Float32Array(d);
      for (let i = 0; i < d; i++) v[i] = step.resid[l * d + i] + step.attnOut[l * d + i];
      this.mid[l].target(v);
      this.mlp[l].target(step.mlpAct.subarray(l * I, (l + 1) * I));
      const hv = Array.from(hn.subarray(l * H, (l + 1) * H), (x) => x / hmax);
      this.heads[l].target(hv); this.heads[l].to.set(hv);
    }

    // --- линии
    const W = this.wires; W.clear();
    const white = new THREE.Color(0xdfe6f0), violet = new THREE.Color(0xa98cf0), gold = new THREE.Color(0xffe08a);
    // магистраль: сильнейшие измерения остаточного потока — насквозь через все пластины потока
    const chain = [this.res[0]];
    for (let l = 0; l < L; l++) chain.push(this.mid[l], this.res[l + 1]);
    const score = new Float32Array(d);
    for (const g of chain) for (let i = 0; i < d; i++) score[i] = Math.max(score[i], Math.abs(g.to[i]));
    const dims = Array.from(score.keys()).sort((a, b) => score[b] - score[a]).slice(0, N_HIGHWAY);
    for (const i of dims) for (let k = 0; k + 1 < chain.length; k++) {
      const a = chain[k], b = chain[k + 1], va = a.to[i], vb = b.to[i];
      W.seg(a.at(i), b.at(i), vb >= 0 ? POS : NEG, 0.08 + 0.3 * Math.min(1, (Math.abs(va) + Math.abs(vb)) / 2), 8, [a.tag, b.tag]);
    }
    for (let l = 0; l < L; l++) {
      // attention: поток -> головы (слабые), головы -> поток после attention (сильнейшие вклады W_o · выход головы)
      const Wo = this.e.weights(l, 'o'), contrib = [];
      let cmax = 1e-9;
      for (let h = 0; h < H; h++) {
        const c = new Float32Array(d);
        for (let i = 0; i < d; i++) {
          let s = 0; const row = i * H * hd + h * hd;
          for (let j = 0; j < hd; j++) s += Wo[row + j] * step.headOut[(l * H + h) * hd + j];
          c[i] = s; cmax = Math.max(cmax, Math.abs(s));
        }
        contrib.push(c);
      }
      for (let h = 0; h < H; h++) {
        const hp = this.heads[l].at(h);
        for (const i of dims.slice(0, 4)) W.seg(this.res[l].at(i), hp, violet, 0.12, 4, [this.res[l].tag, this.heads[l].tag]);
        const top = Array.from(contrib[h].keys()).sort((a, b) => Math.abs(contrib[h][b]) - Math.abs(contrib[h][a])).slice(0, PER_HEAD);
        for (const i of top) W.seg(hp, this.mid[l].at(i), violet, 0.12 + 0.55 * Math.abs(contrib[h][i]) / cmax, 5, [this.heads[l].tag, this.mid[l].tag]);
      }
      // MLP: поток после attention -> сильнейшие нейроны (слабые), нейроны -> поток после слоя (W_down · активация)
      const Wd = this.e.weights(l, 'down'), act = step.mlpAct.subarray(l * I, (l + 1) * I);
      const strength = new Float32Array(I);
      for (let j = 0; j < I; j++) { let m = 0; for (let i = 0; i < d; i++) m = Math.max(m, Math.abs(Wd[i * I + j] * act[j])); strength[j] = m; }
      const neurons = Array.from(strength.keys()).sort((a, b) => strength[b] - strength[a]).slice(0, N_NEURONS);
      const smax = strength[neurons[0]] || 1e-9;
      for (const j of neurons) {
        const np = this.mlp[l].at(j);
        W.seg(this.mid[l].at(dims[j % 4]), np, white, 0.1, 5, [this.mid[l].tag, this.mlp[l].tag]);
        const outs = [];
        for (let i = 0; i < d; i++) outs.push([i, Wd[i * I + j] * act[j]]);
        outs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
        for (const [i, v] of outs.slice(0, PER_NEURON)) W.seg(np, this.res[l + 1].at(i), v >= 0 ? POS : NEG, 0.12 + 0.55 * Math.abs(v) / smax, 5, [this.mlp[l].tag, this.res[l + 1].tag]);
      }
    }

    // вход и кандидаты на выходе
    if (this.inLabel) this.scene.remove(this.inLabel);
    this.inLabel = label(`«${show(this.e.tokenText[step.input])}»`, '#ffe08a', 56, 0.5);
    this.inLabel.position.set(-0.7, 0, 0); this.inLabel.center.set(1, 0.5); this.scene.add(this.inLabel);
    this.out.clear();
    const top = step.forced >= 0 ? [{ tok: step.forced, p: 1 }] : step.topk.slice(0, 7);
    top.forEach((c, i) => {
      const y = ((top.length - 1) / 2 - i) * 0.5, chosen = c.tok === step.output;
      const col = chosen ? gold.clone() : new THREE.Color(0xd9894a);
      const sq = 0.2 + 0.32 * Math.sqrt(c.p);
      const tileM = new THREE.Mesh(new THREE.PlaneGeometry(sq, sq).rotateY(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: chosen ? 1 : 0.25 + 0.75 * Math.sqrt(c.p), side: THREE.DoubleSide, depthWrite: false }));
      tileM.position.set(this.outX, y, 0); this.out.add(tileM);
      const s = label(`${show(this.e.tokenText[c.tok])} ${(100 * c.p).toFixed(0)}%`, chosen ? '#ffe08a' : '#c9ced6', 40, 0.3);
      s.position.set(this.outX + 0.35, y, 0); s.center.set(0, 0.5); this.out.add(s);
      if (chosen) for (const k of dims.slice(0, 6)) W.seg(this.res[L].at(k), new THREE.Vector3(this.outX, y, 0), gold, 0.3, 4, [this.res[L].tag]);
    });
    W.commit();
    this.pulse = animate ? 0 : 1; this.t0 = performance.now();
    this.buildPeaks();
    if (!animate) { for (const p of this.plates) p.apply(1); this.wires.reveal(1e9); }
    this.out.visible = !animate;
  }

  tick() {
    if (this.lay) {
      const k = Math.min(1, (performance.now() - this.lay.t0) / 380), e = k * k * (3 - 2 * k);
      this.placeAt(this.lay.from, this.lay.to, e);
      if (k >= 1) { this.lay = null; this.layoutDone(); }
    }
    if (this.camTo) {
      const k = Math.min(1, (performance.now() - this.camT0) / 600), e = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(this.camFrom.p, this.camTo.p, e);
      this.controls.target.lerpVectors(this.camFrom.t, this.camTo.t, e);
      if (k >= 1) this.camTo = null;
    }
    if (this.pulse < 1) {
      this.pulse = Math.min(1, (performance.now() - this.t0) / this.dur);
      const front = -1 + this.pulse * (this.outX + 2);
      for (const p of this.plates) p.apply(Math.max(0, Math.min(1, (front - p.x) / 1.0)));
      this.wires.reveal(front);
      if (this.pulse >= 1) this.out.visible = true;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

function show(t) { return t === undefined ? '' : t.replace(/\n/g, '↵').replace(/ /g, '·'); }
