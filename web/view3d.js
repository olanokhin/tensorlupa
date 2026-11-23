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
import { partLogit, headPart } from './contrib.js';

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
    }
    this.res.forEach((p, l) => Object.assign(p, { tag: 'res' + l, kind: 'resid', layer: l, name: l === 0 ? tx('m.embedding') : tx('m.resAfter', { n: l }) }));
    this.mid.forEach((p, l) => Object.assign(p, { tag: 'mid' + l, kind: 'mid', layer: l, name: tx('m.midAfter', { n: l + 1 }) }));
    this.heads.forEach((p, l) => Object.assign(p, { tag: 'heads' + l, kind: 'heads', layer: l, name: tx('m.headsOf', { n: l + 1 }) }));
    this.mlp.forEach((p, l) => Object.assign(p, { tag: 'mlp' + l, kind: 'mlp', layer: l, name: tx('m.mlpOf', { n: l + 1 }) }));
    this.plates = [...this.res, ...this.heads, ...this.mid, ...this.mlp];
    for (const p of this.plates) { this.scene.add(p.points); this.scene.add(p.glass, p.frame); }
    // Подписи — слой HTML поверх сцены, а не спрайты в ней: размер на экране постоянный при любом ракурсе, подписи
    // пластин стоят в общей полосе под моделью, расходятся по строкам, если им тесно, и ведут выноской к своей пластине
    this.caps = document.createElement('div'); this.caps.className = 'v3-caps';
    this.capLines = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); this.capLines.setAttribute('class', 'v3-leaders');
    this.caps.appendChild(this.capLines); container.appendChild(this.caps);
    this.labels = [];
    // layer: подписи пластин слоя 1 видны всегда, слоёв 2 и 3 — когда слой под курсором или в нём выбрана пластина
    // (слои устроены одинаково: один подписанный читается лучше трёх)
    const cap = (kind, text, anchor, cls = '', layer) => { const el = document.createElement('span'); el.className = `v3-cap v3-${kind} ${cls}`; el.textContent = text;
      this.caps.appendChild(el); const o = { kind, el, anchor, line: null, layer };
      if (kind === 'sub') { o.line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); this.capLines.appendChild(o.line); }
      this.labels.push(o); };
    const under = (p) => () => new THREE.Vector3(p.x, -p.height / 2 - 0.06, 0);
    // Подписей под пластинами нет: названия блоков уже стоят в линии счёта наверху. Низ отдан формуле слоя (buildFormula).
    for (let l = 0; l < L; l++) {
      cap('title', tx('m.layer', { n: l + 1 }), () => new THREE.Vector3((this.heads[l].x + this.res[l + 1].x) / 2, Math.max(this.mlp[l].height, this.res[l + 1].height) / 2 + 0.25, 0));
    }
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
    // подсказка под курсором и подписи самых длинных столбиков — тоже на слое поверх сцены: внутри сцены их закрывали
    // пластины, стоящие ближе к камере
    this.tip = { el: this.floatCap('v3-tip'), pos: new THREE.Vector3(), visible: false };
    this.peakCaps = [];
    this.inCap = document.createElement('div'); this.inCap.className = 'v3-io v3-in'; this.caps.appendChild(this.inCap);
    this.outCap = document.createElement('div'); this.outCap.className = 'v3-io v3-out'; this.caps.appendChild(this.outCap);
    this.outCap.addEventListener('click', (e) => { const a = e.target.closest('a[data-tok]'); if (a && this.step) { e.stopPropagation(); this.trackTok(Number(a.dataset.tok)); } });
    // карточка-пояснение в углу: как читать сцену; что за пластина под курсором; что значат столбики и три подписи
    this.info = document.createElement('div'); this.info.className = 'v3-info'; this.caps.appendChild(this.info); this.infoKey = null;
    this.buildFormula();
    // «Читать в Docs»: обычный щелчок открывает статью во вкладке Docs студии, с Ctrl/⌘/Shift — как обычная ссылка
    this.info.addEventListener('click', (e) => { const a = e.target.closest('a.v3-info-doc'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault(); window.dispatchEvent(new CustomEvent('mq-open-doc', { detail: a.href })); });
    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointermove', (e) => this.pick(e, false));
    el.addEventListener('pointerleave', () => { this.cursor.visible = false; this.tip.visible = false; this.hov = null; this.hovPlate = null; this.hovKey = ''; if (this.onHover) this.onHover(null, -1); });
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
    this.hovPlate = plate || null;
    // связь с окном «Внимание»: какая пластина (и плитка) под курсором
    const hk = (plate ? plate.tag : '') + ':' + idx; if (hk !== this.hovKey) { this.hovKey = hk; if (this.onHover) this.onHover(plate || null, idx); }
    if (plate && idx >= 0 && this.step) {
      this.cursor.position.copy(plate.at(idx)); this.cursor.scale.setScalar(plate.tile > 1 ? plate.tile : 1); this.cursor.visible = true;
      this.setTip(plate, idx);
    } else { this.cursor.visible = false; this.tip.visible = false; }
    if (click) this.select(plate, idx);
  }
  // выбрать пластину (или снять выбор: plate = null). Щелчок мыши приходит сюда же; напрямую метод зовёт скрипт
  // пересъёмки скриншотов Docs (scripts/docs-shots), потому что в 3D нужную пластину может заслонять соседняя.
  select(plate, idx = 0) {
    this.sel = plate ? { plate, idx } : null; this.opSel = null;
    this.wires.focus = plate ? plate.tag : null;
    for (const p of this.plates) {
      const on = p === plate;
      p.frame.material.color.set(on ? 0xf2b33d : RIM); p.frame.material.opacity = on ? 1 : 0.55;
      p.glass.material.color.set(on ? 0xf2c46a : GLASS); p.glass.material.opacity = on ? 0.1 : 0.075;
    }
    this.layout(true);
    if (this.onSelect) this.onSelect();
  }

  // рельеф выбранной пластины: столбик из каждой плитки перпендикулярно пластине — плюс (жёлтый) влево,
  // минус (сиреневый) вправо, длина — значение (нормировка по вектору); подписи у трёх самых длинных
  // ЭСКИЗ M2. Линия счёта под моделью: как написанный токен набирал свою оценку вдоль остаточного потока.
  // Под каждой пластиной потока — сколько набрано к этой точке (верхняя строка, соединена линией: это «хребет»);
  // под каждым блоком — сколько он добавил (нижняя строка: внимание и MLP ответвляются от потока и возвращаются).
  // Строка под моделью: что происходит ВНУТРИ одной пластины — той, на которую навели или которую выбрали (строка
  // остаётся от последней пластины, чтобы до неё можно было дойти мышью). Шаги идут по порядку вычисления. У RMSNorm,
  // RoPE, QK-norm, GQA нет своих пластин, поэтому на модели они ничего не подсвечивают: шаг объясняется в карточке.
  // Пробовали и отвергли: (1) формулу всей модели с подсветкой пластин трёх слоёв — пять шагов внимания светили одно
  // и то же; (2) формулу всей модели, где горят шаги пластины в контексте — большая формула путала, что считается здесь.
  buildFormula() {
    // id → [подпись, статья Docs]
    this.ops = { embed: [tx('m.op.embed'), 'residual-stream'], norm: ['RMSNorm', 'rmsnorm'], gqa: ['Q, K, V · GQA', 'grouped-query-attention'], qk: ['QK-norm', 'qk-norm'],
      rope: ['RoPE', 'rope'], attn: [tx('m.op.attn'), 'attention'], add: [tx('m.op.add'), 'residual-stream'], swiglu: ['SwiGLU', 'swiglu'], final: [tx('m.op.final'), 'logits'] };
    this.opSteps = { embed: ['embed'], heads: ['norm', 'gqa', 'qk', 'rope', 'attn', 'add'], mid: ['add'], mlp: ['norm', 'swiglu', 'add'], resid: ['add'], last: ['add', 'final'] };
    this.formula = document.createElement('div'); this.formula.className = 'v3-formula'; this.caps.appendChild(this.formula);
    this.opHov = null; this.opSel = null; this.opKey = null; this.fPlate = null;
    this.formula.addEventListener('pointerover', (e) => { const a = e.target.closest('a[data-op]'); this.opHov = a ? a.dataset.op : null; });
    this.formula.addEventListener('pointerleave', () => { this.opHov = null; });
    this.formula.addEventListener('click', (e) => { const a = e.target.closest('a[data-op]'); if (!a) return; this.opSel = this.opSel === a.dataset.op ? null : a.dataset.op; });
    // закреплённый шаг сбрасывается щелчком в любое другое место (кроме самой строки шагов и карточки со ссылкой)
    document.addEventListener('pointerdown', (e) => { if (this.opSel && !this.formula.contains(e.target) && !this.info.contains(e.target)) this.opSel = null; });
    this.docs = new Set();                             // какие статьи Docs уже написаны (список пишет сборка Docs)
    fetch('/docs/pages.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.glossary) { this.docs = new Set(j.glossary); this.infoKey = null; } }).catch(() => {});
  }
  // раз в кадр, но DOM и материалы трогаем только когда что-то изменилось
  syncFormula() {
    const cur = this.sel ? this.sel.plate : this.hovPlate;
    if (cur && cur !== this.fPlate) { this.fPlate = cur; this.opSel = null; this.opHov = null; }
    const pl = this.fPlate, opId = this.opHov || this.opSel || '';
    const key = (pl ? pl.tag : '') + '|' + opId + '|' + (this.sel ? this.sel.plate.tag : '') + '|' + (cur ? 1 : 0) + '|' + (this.linkPlate ? this.linkPlate.tag : '');
    if (key === this.opKey) return; this.opKey = key; this.infoKey = null;
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'), L = this.e.info.layers;
    if (!pl) this.formula.innerHTML = `<small>${esc(tx('m.op.idle'))}</small>`;
    else {
      const kind = pl.kind === 'resid' ? (pl.layer === 0 ? 'embed' : pl.layer === L ? 'last' : 'resid') : pl.kind;
      this.formula.innerHTML = `<small>${esc(tx('m.op.inside', { name: pl.name }))}</small> ` +
        this.opSteps[kind].map((id) => `<a data-op="${id}" class="${id === opId ? 'on' : ''}">${esc(this.ops[id][0])}</a>`).join(' <i>→</i> ');
    }
    // рамка: выбранная пластина; пока мышь на строке — пластина, о которой строка
    const mark = this.sel ? this.sel.plate : (!cur && this.opHov ? pl : null);
    this.opPlate = !cur && this.opHov ? pl : null;
    for (const p of this.plates) { const on = p === mark || p === this.linkPlate, sel = this.sel && p === this.sel.plate;   // linkPlate: голова выбрана в окне «Внимание»
      p.frame.material.color.set(on ? 0xf2b33d : RIM); p.frame.material.opacity = on ? 1 : 0.55;
      p.glass.material.color.set(sel ? 0xf2c46a : GLASS); p.glass.material.opacity = sel ? 0.1 : 0.075; }
  }

  buildScore() {
    for (const o of this.score || []) { o.el.remove(); o.line.remove(); if (o.nameEl) o.nameEl.remove(); if (o.el2) o.el2.remove(); }
    this.score = [];
    if (this.spine) this.spine.remove();
    this.spine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); this.spine.setAttribute('class', 'v3-spine'); this.capLines.appendChild(this.spine);
    if (!this.step) return;
    const { layers: L, dim: d } = this.e.info, st = this.step, tok = st.output, alt = this.track, fmt = (x) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(1);
    // Одна строка чисел, читается слева направо как арифметика: счёт, +вклад блока, новый счёт… Над каждым вкладом —
    // словом, чей он (внимание или MLP), над парой — слой. Чисел нет нигде, кроме цепочки: раньше сумма слоя, вклад
    // блока и счёт стояли в трёх строках и читались как три разных «плюса».
    // Верхняя строка — всегда написанное слово. Если выбран другой кандидат, его числа встают второй строкой под ней:
    // поток один, а каждое слово читает его по-своему, и видно, на каком блоке кандидат отстал.
    const add = (plate, text, cls, name, text2, cls2) => { const el = document.createElement('span'); el.className = 'v3-cap v3-score ' + cls; el.textContent = text; this.caps.appendChild(el);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); line.setAttribute('class', 'v3-score-lead'); this.capLines.appendChild(line);
      let nameEl = null; if (name) { nameEl = document.createElement('span'); nameEl.className = 'v3-cap v3-score-name'; nameEl.textContent = name; this.caps.appendChild(nameEl); }
      let el2 = null; if (text2 != null) { el2 = document.createElement('span'); el2.className = 'v3-cap v3-score v3-alt ' + cls2; el2.textContent = text2; this.caps.appendChild(el2); }
      this.score.push({ el, el2, line, plate, nameEl, layer: name ? plate.layer : -1 }); };
    const vec = new Float32Array(d), sign = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1);   // один знак: цепочка должна помещаться над моделью
    const total = (l, mid, t) => { for (let i = 0; i < d; i++) vec[i] = st.resid[l * d + i] + (mid ? st.attnOut[l * d + i] : 0); return this.partLogit(vec, t); };
    const run = (plate, l, mid) => add(plate, fmt(total(l, mid, tok)), 'v3-run', null, alt == null ? null : fmt(total(l, mid, alt)), 'v3-run');
    const delta = (plate, arr, l, name) => { const part = Float32Array.from(arr.subarray(l * d, (l + 1) * d)), a = this.partLogit(part, tok), b = alt == null ? 0 : this.partLogit(part, alt);
      add(plate, sign(a), a >= 0 ? 'v3-pos' : 'v3-neg', name, alt == null ? null : sign(b), b >= 0 ? 'v3-pos' : 'v3-neg'); };
    run(this.res[0], 0, false);
    for (let l = 0; l < L; l++) {
      delta(this.heads[l], st.attnOut, l, tx('m.score.attn'));
      run(this.mid[l], l, true);
      delta(this.mlp[l], st.mlpOut, l, 'MLP');
      run(this.res[l + 1], l + 1, false);
    }
    let k = 0; for (const o of this.labels) if (o.kind === 'title') { o.el.textContent = tx('m.layer', { n: k + 1 }); o.w = 0; o.layerIdx = k; k++; }
    if (!this.scoreLabel) { this.scoreLabel = document.createElement('span'); this.scoreLabel.className = 'v3-cap v3-score-name v3-score-what'; this.caps.appendChild(this.scoreLabel); }
    // подпись слева — в две строки («счёт» и под ним токен): она узкая и не сдвигает цепочку вправо от пластин
    const q = (t) => `«${String(show(this.e.tokenText[t])).replace(/&/g, '&amp;').replace(/</g, '&lt;')}»`;
    this.scoreLabel.innerHTML = `${tx('m.score.what')}<b>${q(tok)}</b>` + (alt == null ? '' : `<b class="v3-alt">${q(alt)}</b>`); this.scoreLabel.w = 0;
    this.scoreTok = show(this.e.tokenText[tok]);
  }

  buildPeaks() {
    for (const o of this.peaks.children) { o.geometry && o.geometry.dispose(); }
    this.peaks.clear();
    for (const c of this.peakCaps) c.el.remove(); this.peakCaps = [];
    if (!this.sel || !this.step) return;
    const p = this.sel.plate, w = S * 0.55 * (p.tile > 1 ? p.tile * 0.7 : 1);
    const xs = this.plates.map((q) => q.x).sort((a, b) => a - b), k = xs.indexOf(p.x);
    const gapL = k > 0 ? p.x - xs[k - 1] : SEL_GAP, gapR = k < xs.length - 1 ? xs[k + 1] - p.x : this.outX - p.x - 0.3;
    const LENL = 0.9 * gapL, LENR = 0.9 * gapR;          // плюс — влево, минус — вправо: не дальше соседа
    const geo = new THREE.BoxGeometry(1, w, w); geo.translate(0.5, 0, 0);
    // столбики — сплошные бруски: непрозрачные, с записью глубины — ближний всегда закрывает дальний
    // (полупрозрачные без глубины рисовались по порядку экземпляров, и сиреневые «пробивали» янтарные)
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: false, depthWrite: true }), p.n);
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
    // что подписывать: у MLP — три самых сильных нейрона и слова, которые каждый подталкивает; у голов — все четыре
    // и токен, на который голова смотрит сильнее всего; у потока — ничего (у отдельного числа потока нет понятного
    // смысла: вместо этого карточка показывает, что модель сказала бы, остановись она здесь)
    // (у MLP — не самые активные, а те, что сильнее всего подтолкнули написанный токен: активация и влияние — разное)
    // У MLP отдельные нейроны не подписываем вовсе: работа слоя размазана по десяткам нейронов (80% дают ~80 из 336),
    // и «три лидера» ничего не объясняют. Над пластиной — одна подпись по сути: сколько весь слой добавил написанному
    // токену. Отдельный нейрон виден при наведении на его столбик.
    // (у голов так же: над пластиной — итог всего внимания слоя; куда смотрит каждая голова — в карточке)
    // отдельной подписи над раскрытой пластиной нет: её число уже стоит в линии счёта наверху — там оно подсвечивается
    const picks = [];
    const name = tx(p.kind === 'mlp' ? 'm.neuron' : p.kind === 'heads' ? 'm.head' : 'm.number');
    const lead = [], leadCol = [];
    picks.forEach((i, k) => {
      const v = this.value(p, i), at = p.at(i), len = (p.to[i] >= 0 ? LENL : LENR) * Math.abs(p.to[i]);
      const tip = new THREE.Vector3(at.x + (p.to[i] >= 0 ? -len : len), at.y, at.z);
      // выше заголовка «слой N» (он на высоте 3.1), чтобы не наезжать на него
      const ly = Math.max(p.height / 2 + 0.35, 3.6) + (picks.length - 1 - k) * 0.36, anchor = new THREE.Vector3(p.x, ly, at.z * 0.3);
      const el = this.floatCap('v3-peak ' + (v >= 0 ? 'v3-pos' : 'v3-neg'));
      {                                         // голова: куда она смотрит сильнее всего на этом шаге
        const H = this.e.info.heads, n = this.step.pos + 1, wts = this.step.attnP.subarray((p.layer * H + i) * n, (p.layer * H + i + 1) * n);
        let best = 0; for (let t = 1; t < n; t++) if (wts[t] > wts[best]) best = t;
        el.textContent = tx('m.peak.head', { h: i + 1, tok: show(this.e.tokenText[this.steps[best].input]), pct: (100 * wts[best]).toFixed(0) });
      }
      this.peakCaps.push({ el, pos: anchor.clone() });
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
    if (plate.kind === 'mlp') { const c = this.neuronParts(plate.layer)[i];
      t = `${name} · «${show(this.e.tokenText[this.tok])}» ${Math.abs(c) < 0.005 ? '≈0' : (c >= 0 ? '+' : '−') + Math.abs(c).toFixed(2)} · ${tx('m.tip.pushes')} ${this.push(plate.layer, i, 3).map((x) => x.w).join(', ')}`; }
    // голова: вклад в счёт слова, как у нейрона (раньше здесь стояла длина её выхода — число, которое ни с чем не сходилось;
    // теперь четыре головы слоя в сумме дают «вним. +x» из линии счёта, и то же число стоит в карточке окна «Внимание»)
    if (plate.kind === 'heads') { const c = this.headPart(plate.layer, i);
      t = `${name} · «${show(this.e.tokenText[this.tok])}» ${Math.abs(c) < 0.005 ? '≈0' : (c >= 0 ? '+' : '−') + Math.abs(c).toFixed(2)}`; }
    this.tip.el.textContent = t; this.tip.pos.copy(plate.at(i)); this.tip.visible = true;
  }

  value(plate, i) {
    const { dim: d, inter: I, heads: H, headDim: hd } = this.e.info, st = this.step, l = plate.layer;
    if (plate.kind === 'resid') return st.resid[l * d + i];
    if (plate.kind === 'mid') return st.resid[l * d + i] + st.attnOut[l * d + i];
    if (plate.kind === 'mlp') return st.mlpAct[l * I + i];
    let s = 0; for (let j = 0; j < hd; j++) { const x = st.headOut[(l * H + i) * hd + j]; s += x * x; } return Math.sqrt(s);
  }

  // слова, которые вектор «толкает» вверх (logit lens): топ-k
  // Токен, чей путь показывает сцена: по умолчанию тот, что модель написала; щелчок по кандидату в блоке выхода
  // переключает на него — видно, почему проигравший проиграл (а не только как победил победитель).
  get tok() { return this.track != null ? this.track : this.step.output; }

  // Сколько очков вектор v (часть остаточного потока) добавил логиту токена tok на этом шаге. Финальная норма делит
  // весь поток на его rms, поэтому вклад части — её проекция через норму и словарь в масштабе фактического потока.
  // Вклады эмбеддинга, внимания и MLP всех слоёв в сумме дают логит модели (проверено: расхождение в сотых).
  partLogit(v, tok) { return partLogit(this.e, this.step, v, tok); }
  // вклад головы h слоя l в логит отслеживаемого токена: её выход через W_o, прочитанный логит-линзой
  headPart(l, h) { return headPart(this.e, this.step, l, h, this.tok); }
  // вклад каждого нейрона слоя l в логит написанного токена (кэш: считается один раз на шаг и слой)
  neuronParts(l) {
    const key = this.step.pos + ':' + l + ':' + this.tok;
    if (this.npCache && this.npCache.key === key) return this.npCache.c;
    const { dim: d, inter: I } = this.e.info, Wd = this.e.weights(l, 'down'), a = this.step.mlpAct, c = new Float32Array(I), v = new Float32Array(d);
    for (let j = 0; j < I; j++) { const x = a[l * I + j]; if (Math.abs(x) < 1e-6) continue; for (let i = 0; i < d; i++) v[i] = Wd[i * I + j] * x; c[j] = this.partLogit(v, this.tok); }
    this.npCache = { key, c }; return c;
  }

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
    // название пластины с подсказкой глоссария: эмбеддинг, остаточный поток, MLP, головы внимания
    const term = plate.kind === 'mlp' ? 'mlp' : plate.kind === 'heads' ? 'head' : l === 0 && plate.kind === 'resid' ? 'embedding' : 'residualStream';
    let h = `<h4>${tx('m.selected', { name: `<span data-term="${term}">${plate.name}</span>` })}</h4>`;
    if (plate.kind === 'resid' || plate.kind === 'mid') {
      const v = new Float32Array(d);
      for (let i = 0; i < d; i++) v[i] = plate.kind === 'resid' ? st.resid[l * d + i] : st.resid[l * d + i] + st.attnOut[l * d + i];
      h += `<div class="note"><span data-term="logitLens">${tx('m.lens')}</span></div><div class="note">${this.lensTop(v, 5).map((x) => pill(x.w) + ' ' + pct(x.p)).join(' ')}</div>`;
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
    else { dir = new THREE.Vector3(-0.62, 0.36, 0.78); tgt = new THREE.Vector3(cx, 0, 0); dist = Math.max(span * 1.05, fitW * 1.15); }   // узкий или высокий вид — дальше: слои и подпись входного токена слева не обрезаются
    dir.normalize();
    const pos = tgt.clone().addScaledVector(dir, dist);
    this.camera.near = dist / 80; this.camera.far = dist * 6; this.camera.updateProjectionMatrix();
    if (!animate) { this.camera.position.copy(pos); this.controls.target.copy(tgt); return; }
    this.camFrom = { p: this.camera.position.clone(), t: this.controls.target.clone() };
    this.camTo = { p: pos, t: tgt }; this.camT0 = performance.now();
  }

  set(step, animate = true, dur = 600, steps = null) {
    if (!step) return;
    if (!this.step || this.step.pos !== step.pos || this.step.output !== step.output) this.track = null;   // новый шаг — снова написанный токен
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
    // начало и конец пути — пара одинаковых блоков поверх сцены: слева вход (прошлый токен), справа выход (токен,
    // который модель написала, его шанс и остальные кандидаты). Раньше вход был словом в кавычках, а победитель в
    // списке отличался только цветом — что это старт и финиш одного пути, из картинки не читалось.
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    this.inCap.innerHTML = `<small>${esc(tx('m.io.in'))}</small><b>«${esc(show(this.e.tokenText[step.input]))}»</b>`;
    this.out.clear();
    const top = step.forced >= 0 ? [{ tok: step.forced, p: 1 }] : step.topk.slice(0, 7);
    this.outTop = top; this.renderOut();
    top.forEach((c, i) => {
      const y = ((top.length - 1) / 2 - i) * 0.5, chosen = c.tok === step.output;
      const col = chosen ? gold.clone() : new THREE.Color(0xd9894a);
      const sq = 0.2 + 0.32 * Math.sqrt(c.p);
      const tileM = new THREE.Mesh(new THREE.PlaneGeometry(sq, sq).rotateY(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: chosen ? 1 : 0.25 + 0.75 * Math.sqrt(c.p), side: THREE.DoubleSide, depthWrite: false }));
      tileM.position.set(this.outX, y, 0); this.out.add(tileM);
      if (chosen) for (const k of dims.slice(0, 6)) W.seg(this.res[L].at(k), new THREE.Vector3(this.outX, y, 0), gold, 0.3, 4, [this.res[L].tag]);
    });
    W.commit();
    this.pulse = animate ? 0 : 1; this.t0 = performance.now();
    this.buildPeaks();
    this.buildScore();
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
    this.placeCaps();
  }

  // Подписи: якорь каждой проецируется на экран. Заголовки слоёв — над слоем. Подписи пластин — в полосе под самой
  // нижней пластиной; при тесноте подпись уходит на следующую строку, а к пластине ведёт тонкая выноска.
  // текст карточки-пояснения: выбранная пластина важнее наведённой; без них — как читать сцену
  updateInfo() {
    const pl = this.sel ? this.sel.plate : this.hovPlate, key = (this.sel ? 's' : 'h') + (pl ? pl.tag : '-') + ':' + (this.step ? this.step.pos + ':' + this.tok : '');
    const opId = this.opHov || this.opSel || '';
    if (key + opId === this.infoKey) return; this.infoKey = key + opId;
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    if (opId) {                                      // операция из формулы слоя: что это и зачем, со ссылкой на статью
      const op = { slug: this.ops[opId][1], text: opId }, lang = document.documentElement.lang || 'en', I = this.e.info;
      const link = this.docs.has(op.slug) ? `<a class="gloss-more v3-info-doc" target="_blank" rel="noopener" href="/${lang === 'en' ? '' : lang + '/'}docs/glossary/${op.slug}/">${esc(tx('gl.more'))}</a>` : '';
      this.info.innerHTML = `<b>${esc(tx('m.op.' + op.text + '.h'))}</b><p>${esc(tx('m.op.' + op.text + '.t', { d: I.dim, n: I.inter, h: I.heads, kv: I.kvHeads, v: I.vocab }))}</p>` +
        (this.opSel === opId ? link : `<p class="v3-info-hint">${esc(tx('m.op.pin'))}</p>`);
      return;
    }
    if (!pl) {                                       // ничего не выбрано: история этого шага настоящими токенами
      if (!this.step) { this.info.innerHTML = `<b>${esc(tx('m.info.idle.h'))}</b>`; return; }
      const st = this.step, L = this.e.info.layers, d = this.e.info.dim, T = (t) => `<i>«${esc(show(this.e.tokenText[t]))}»</i>`;
      const fin = Float32Array.from(st.resid.subarray(L * d, (L + 1) * d)), score = this.partLogit(fin, st.output).toFixed(1);
      const story = this.track == null ? tx('m.info.idle', { in: T(st.input), out: T(st.output), score })
        : tx('m.info.idle.lost', { in: T(st.input), out: T(st.output), score, alt: T(this.track), altScore: this.partLogit(fin, this.track).toFixed(1) });
      this.info.innerHTML = `<b>${esc(tx('m.info.idle.h'))}</b><p class="v3-info-story">${story}</p>` +
        `<p class="v3-info-hint">${esc(tx(this.track == null ? 'm.info.idle.click' : 'm.io.back'))}</p>`;
      return;
    }
    const kind = pl.kind === 'resid' && pl.layer === 0 ? 'embed' : pl.kind;
    const n = pl.kind === 'resid' ? pl.layer : pl.layer + 1;
    let extra = '';
    if (this.step && (pl.kind === 'resid' || pl.kind === 'mid')) {   // поток: что модель сказала бы, остановись она здесь
      const d = this.e.info.dim, st = this.step, l = pl.layer, vec = new Float32Array(d);
      for (let i = 0; i < d; i++) vec[i] = pl.kind === 'resid' ? st.resid[l * d + i] : st.resid[l * d + i] + st.attnOut[l * d + i];
      extra = `<p class="v3-info-lens">${esc(tx('m.info.lens'))}<span>${this.lensTop(vec, 4).map((x) => `<i>${esc(x.w)}</i> ${(100 * x.p).toFixed(0)}%`).join(' · ')}</span></p>`;
    }
    let selText = '';
    if (this.step && (pl.kind === 'mlp' || pl.kind === 'heads')) {   // слой целиком: сколько очков блок добавил написанному токену
      const d = this.e.info.dim, st = this.step, l = pl.layer, src = pl.kind === 'mlp' ? st.mlpOut : st.attnOut;
      const tot = this.partLogit(Float32Array.from(src.subarray(l * d, (l + 1) * d)), this.tok), tokS = `«${esc(show(this.e.tokenText[this.tok]))}»`;
      if (!this.sel) extra = `<p class="v3-info-lens">${esc(tx(pl.kind === 'mlp' ? 'm.info.sum.mlp' : 'm.info.sum.attn'))} <i>${tokS} ${tot >= 0 ? '+' : '−'}${Math.abs(tot).toFixed(2)}</i></p>`;
      if (pl.kind === 'heads') {                      // куда смотрит каждая голова сильнее всего
        const H = this.e.info.heads, n = st.pos + 1; let rows = '';
        for (let hh = 0; hh < H; hh++) { const wts = st.attnP.subarray((l * H + hh) * n, (l * H + hh + 1) * n); let best = 0; for (let t = 1; t < n; t++) if (wts[t] > wts[best]) best = t;
          rows += `<span>${hh + 1} → <i>${esc(show(this.e.tokenText[this.steps[best].input]))}</i> ${(100 * wts[best]).toFixed(0)}%</span>`; }
        extra += `<p class="v3-info-lens v3-info-heads">${esc(tx('m.info.looks'))}${rows}</p>`;
      }
    }
    const selKey = pl.kind === 'mlp' ? 'm.info.sel' : pl.kind === 'heads' ? 'm.info.sel.heads' : 'm.info.sel.stream';
    this.info.innerHTML = `<b>${esc(pl.name)}</b><span class="v3-info-n">${esc(tx('m.info.count', { n: pl.n }))}</span><p>${esc(tx('m.info.' + kind, { n, count: pl.n }))}</p>` + extra +
      (this.sel ? `<p class="v3-info-sel">${esc(selText || tx(selKey))}</p>` : `<p class="v3-info-hint">${esc(tx('m.info.click'))}</p>`);
  }

  // блок выхода: написанный токен крупно, остальные кандидаты — строкой; любой можно щёлкнуть, и сцена покажет его путь
  renderOut() {
    const st = this.step, top = this.outTop || [], esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    // шанс написанного токена берём из полного списка шага: в коротком списке сцены его может не быть (выпал редкий
    // вариант), и тогда рядом с написанным словом стояло «0%»
    const full = st.topk ? Array.from(st.topk).find((c) => c.tok === st.output) : null;
    const win = top.find((c) => c.tok === st.output) || { tok: st.output, p: full ? full.p : 0 }, rest = top.filter((c) => c.tok !== st.output).slice(0, 4);
    const row = (c, written) => `<a data-tok="${c.tok}" class="${this.tok === c.tok ? 'on' : ''}${written ? ' won' : ''}"><em>${esc(show(this.e.tokenText[c.tok]))}</em><i>${c.p > 0 && c.p < 0.005 ? '<1' : (100 * c.p).toFixed(0)}%</i></a>`;
    this.outCap.innerHTML = `<small>${esc(tx(st.forced >= 0 ? 'm.io.forced' : 'm.io.out'))}</small>` + row(win, true) +
      (rest.length ? `<small>${esc(tx('m.io.rest'))}</small>` + rest.map((c) => row(c, false)).join('') : '');
  }
  // щелчок по кандидату: следим за ним (щелчок по написанному — вернуться)
  trackTok(t) {
    this.track = t === this.step.output ? null : t;
    this.npCache = null; this.infoKey = null;
    this.renderOut(); this.buildPeaks(); this.buildScore();
  }

  floatCap(cls) { const el = document.createElement('span'); el.className = 'v3-cap v3-float ' + cls; el.style.display = 'none'; this.caps.appendChild(el); return el; }

  placeCaps() {
    const w = this.box.clientWidth, h = this.box.clientHeight; if (!w || !h) return;
    this.syncFormula(); this.updateInfo();
    this.formula.style.right = (this.info.offsetWidth + 22) + 'px';
    this.caps.classList.toggle('v3-narrow', w < 620);   // узкое окно: в карточке только название, без абзацев
    const v = new THREE.Vector3(), items = [], titles = [];
    // плавающие подписи: подсказка — справа-сверху от плитки под курсором; подписи столбиков — над своим якорем
    const float = (el, pos, on, dx, dy, center, maxY = Infinity) => {
      v.copy(pos).project(this.camera);
      if (!on || v.z < -1 || v.z > 1) { el.style.display = 'none'; return Infinity; }
      el.style.display = '';
      const ew = el.offsetWidth, x = (v.x * 0.5 + 0.5) * w + dx - (center ? ew / 2 : 0), y = Math.max(4, Math.min(maxY, (-v.y * 0.5 + 0.5) * h + dy));
      el.style.transform = `translate(${Math.round(Math.max(4, Math.min(w - ew - 4, x)))}px, ${Math.round(y)}px)`;
      return y;
    };
    float(this.tip.el, this.tip.pos, this.tip.visible, 12, -26, false);
    // вход — справа прижат к точке перед эмбеддингом; выход — слева прижат к столбику кандидатов
    const io = (el, x, on, alignRight) => { v.set(x, 0, 0).project(this.camera);
      if (!on || !el.firstChild || v.z < -1 || v.z > 1) { el.style.display = 'none'; return; }
      el.style.display = ''; const ew = el.offsetWidth, eh = el.offsetHeight, sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      const px = Math.max(4, Math.min(w - ew - 4, alignRight ? sx - ew : sx)); let py = Math.max(4, sy - eh / 2);
      // Справа сцене тесно: линия счёта наверху, под ней блок выхода, внизу карточка-пояснение. Если всё не помещается,
      // уступает то, что сейчас менее нужно: при наведённой или раскрытой пластине блок выхода сжимается до написанного
      // и отслеживаемого слова; иначе карточка сворачивается до заголовка. Решаем по полным высотам, чтобы не мигало.
      if (!alignRight) {
        const top0 = (this.laneBottom || 0) + 8, iw = this.info.offsetWidth + 14;
        if (!this.info.classList.contains('v3-tight')) this.infoFull = this.info.offsetHeight + 16;
        if (!el.classList.contains('v3-compact')) this.outFull = eh;
        const fits = top0 + (this.outFull || eh) + (this.infoFull || 0) <= h, clash = px + ew > w - iw, focused = !!(this.sel || this.hovPlate || this.opHov || this.opSel);
        el.classList.toggle('v3-compact', clash && !fits && focused);
        this.info.classList.toggle('v3-tight', clash && !fits && !focused);
        py = Math.max(py, top0);
        if (clash) py = Math.max(top0, Math.min(py, h - this.info.offsetHeight - 16 - el.offsetHeight));
      }
      el.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`; };
    io(this.inCap, this.res[0].x - 0.6, true, true); io(this.outCap, this.outX + 0.4, this.out.visible, false);
    // подписи столбиков — столбиком: каждая следующая не ближе 20px к предыдущей (якоря в сцене стоят теснее)
    let top = Infinity;
    for (let k = this.peakCaps.length - 1; k >= 0; k--) { const c = this.peakCaps[k]; top = float(c.el, c.pos, this.peaks.visible, 0, -18, true, top - 20); }
    // слой, чьи подписи показать: выбранная пластина важнее наведённой; поток после слоя l относится к слою l
    const lay = (pl) => (pl ? (pl.kind === 'resid' ? Math.max(0, pl.layer - 1) : pl.layer) : -1);
    const capL = this.sel ? lay(this.sel.plate) : lay(this.hovPlate);
    for (const o of this.labels) {
      v.copy(o.anchor()).project(this.camera);
      const on = v.z > -1 && v.z < 1;
      const mine = o.layer === undefined || o.layer === 0 || o.layer === capL;
      o.sx = (v.x * 0.5 + 0.5) * w; o.sy = (-v.y * 0.5 + 0.5) * h; o.on = on && mine && o.sx > -40 && o.sx < w + 40;
      if (o.w === undefined || o.w === 0) o.w = o.el.offsetWidth;
      if (o.kind === 'title') { o.el.style.display = 'none'; if (o.on) titles.push(o); }
      else if (o.on) items.push(o); else { o.el.style.display = 'none'; o.line.style.display = 'none'; }
    }
    // подписи пластин — полоса под моделью (слой 1 всегда, слои 2 и 3 — при наведении или выборе)
    const right = w - this.info.offsetWidth - 14;
    if (items.length) {
      items.sort((a, b) => a.sx - b.sx);
      const ROWS = 5, lane = Math.min(h - ROWS * 17 - 6, Math.max(...items.map((o) => o.sy)) + 16), rows = [];
      for (const o of items) {
        const x0 = Math.max(4, Math.min(right - o.w - 4, o.sx - o.w / 2)); let r = 0;
        while (rows[r] !== undefined && rows[r] > x0 - 10) r++;
        const showIt = r < ROWS;
        o.el.style.display = showIt ? '' : 'none'; o.line.style.display = showIt ? '' : 'none';
        if (!showIt) continue;
        rows[r] = x0 + o.w; const y = lane + r * 17;
        o.el.style.transform = `translate(${Math.round(x0)}px, ${Math.round(y)}px)`;
        o.line.setAttribute('x1', o.sx.toFixed(1)); o.line.setAttribute('y1', (o.sy + 2).toFixed(1));
        o.line.setAttribute('x2', Math.max(x0 + 6, Math.min(x0 + o.w - 6, o.sx)).toFixed(1)); o.line.setAttribute('y2', (y - 1).toFixed(1));
      }
    }
    // линия счёта — над моделью: путь токена. Верхняя строка — названия слоёв с суммой слоя, под ней вклады блоков,
    // ниже «хребет»: сколько токен набрал к каждой точке потока. Выноски идут вниз, к верху своих пластин.
    const sc = (this.score || []).filter((o) => { v.set(o.plate.x, o.plate.height / 2 + 0.06, 0).project(this.camera); o.sx = (v.x * 0.5 + 0.5) * w; o.sy = (-v.y * 0.5 + 0.5) * h;
      const on = v.z > -1 && v.z < 1; if (!on) { o.el.style.display = 'none'; o.line.style.display = 'none'; if (o.el2) o.el2.style.display = 'none'; } return on; });
    if (!sc.length) { if (this.spine) this.spine.setAttribute('points', ''); if (this.scoreLabel) this.scoreLabel.style.display = 'none'; return; }
    const focus = this.sel ? this.sel.plate : this.hovPlate;      // её ячейка в линии счёта подсвечена
    const laneTop = Math.max(40, Math.min(...sc.map((o) => o.sy)) - 50), chainY = laneTop + 18, pts = [], mid = {}, bound = {}; let last = -Infinity;
    sc.sort((a, b) => a.sx - b.sx);
    if (!this.scoreLabel.w) this.scoreLabel.w = this.scoreLabel.offsetWidth;
    const startX = Math.max(this.scoreLabel.w + 10, 4);        // слева от цепочки — подпись, что это за числа
    // Числа стоят над своими пластинами, насколько позволяет место. Где им тесно, раздвигаем в обе стороны поровну:
    // раскладка «всё вправо от желаемого» и «всё влево» усредняются (обе без наложений, значит и среднее без них),
    // иначе вся цепочка уезжала вправо от пластин.
    const GAP = 3, n = sc.length, want = [], fw = [], bw = [];
    for (const o of sc) { if (!o.w) { o.w1 = o.el.offsetWidth; o.w2 = o.el2 ? o.el2.offsetWidth : 0; o.w = Math.max(o.w1, o.w2); } want.push(o.sx - o.w / 2); }
    for (let i2 = 0; i2 < n; i2++) fw[i2] = Math.max(want[i2], i2 ? fw[i2 - 1] + sc[i2 - 1].w + GAP : -Infinity);
    for (let i2 = n - 1; i2 >= 0; i2--) bw[i2] = Math.min(want[i2], i2 < n - 1 ? bw[i2 + 1] - sc[i2].w - GAP : Infinity);
    const xs = fw.map((f, i2) => (f + bw[i2]) / 2);
    for (let i2 = 0; i2 < n; i2++) xs[i2] = Math.max(xs[i2], startX, i2 ? xs[i2 - 1] + sc[i2 - 1].w + GAP : -Infinity);   // левая граница
    for (let i2 = n - 1; i2 >= 0; i2--) xs[i2] = Math.min(xs[i2], w - sc[i2].w - 56, i2 < n - 1 ? xs[i2 + 1] - sc[i2].w - GAP : Infinity);   // правая: кнопка камеры
    for (let i2 = 0; i2 < n; i2++) {
      const o = sc[i2], x0 = xs[i2];
      o.el.style.display = ''; o.line.style.display = '';
      const hot = o.plate === focus || (!focus && (o.plate === this.opPlate || o.plate === this.linkPlate)); if (hot !== o.hot) { o.hot = hot; o.el.classList.toggle('on', hot); o.line.classList.toggle('on', hot); if (o.el2) o.el2.classList.toggle('on', hot); }
      const cx = x0 + o.w / 2;
      o.el.style.transform = `translate(${Math.round(cx - o.w1 / 2)}px, ${Math.round(chainY)}px)`;
      if (o.el2) { o.el2.style.display = ''; o.el2.style.transform = `translate(${Math.round(cx - o.w2 / 2)}px, ${Math.round(chainY + 21)}px)`; }
      o.line.setAttribute('x1', cx.toFixed(1)); o.line.setAttribute('y1', (chainY + (o.el2 ? 38 : 17)).toFixed(1)); o.line.setAttribute('x2', o.sx.toFixed(1)); o.line.setAttribute('y2', (o.sy - 2).toFixed(1));
      pts.push(`${cx.toFixed(1)},${(chainY + 8).toFixed(1)}`);
      // слой владеет своим вкладом внимания, вкладом MLP и счётом после себя; эмбеддинг (первое число) — ничей
      if (o.plate.kind === 'resid') bound['e' + o.plate.layer] = x0 + o.w - 2;
      else if (o.nameEl && bound['s' + o.layer] === undefined) bound['s' + o.layer] = x0 + 2;       // счёт на границе слоёв: конец одного и начало следующего
      if (o.nameEl) { if (!o.nw) o.nw = o.nameEl.offsetWidth; o.nameEl.style.display = ''; o.nameEl.style.transform = `translate(${Math.round(cx - o.nw / 2)}px, ${Math.round(laneTop + 2)}px)`;
        (mid[o.layer] = mid[o.layer] || []).push(cx); }
    }
    for (const o of this.score) if (o.nameEl && !sc.includes(o)) o.nameEl.style.display = 'none';
    this.spine.setAttribute('points', pts.join(' '));
    this.scoreLabel.style.display = ''; this.scoreLabel.style.transform = `translate(${Math.round(Math.max(4, xs[0] - this.scoreLabel.w - 6))}px, ${Math.round(chainY - 6)}px)`;
    this.laneBottom = chainY + 18 + (this.track != null ? 21 : 0);
    // слой — отрезок цепочки от счёта до него до счёта после него: скобка идёт от граничного числа до граничного, соседние
    // скобки сходятся на общем числе (оно и «после слоя 1», и «до слоя 2»). Так видно, что 12.82 — итог слоя 2,
    // а не чей-то отдельный вклад.
    for (const o of titles) { const a = bound['s' + o.layerIdx], b = bound['e' + (o.layerIdx + 1)];
      if (!o.brace) { o.brace = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); o.brace.setAttribute('class', 'v3-brace'); this.capLines.appendChild(o.brace); }
      if (a === undefined || b === undefined) { o.el.style.display = 'none'; o.brace.setAttribute('points', ''); continue; }
      o.el.style.display = ''; if (!o.w) o.w = o.el.offsetWidth;
      o.el.style.transform = `translate(${Math.round((a + b) / 2 - o.w / 2)}px, ${Math.round(laneTop - 15)}px)`;
      const x1 = a, x2 = b, by = laneTop + 1;
      o.brace.setAttribute('points', `${x1.toFixed(1)},${(by + 5).toFixed(1)} ${x1.toFixed(1)},${by.toFixed(1)} ${x2.toFixed(1)},${by.toFixed(1)} ${x2.toFixed(1)},${(by + 5).toFixed(1)}`); }
    void 0;
  }
}

function show(t) { return t === undefined ? '' : t.replace(/\n/g, '↵').replace(/ /g, '·'); }
