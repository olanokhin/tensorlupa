// Своя модель с компьютера: файл .bin из блокнота Colab (micro-qwen3-8bit.bin или micro-qwen3-4bit.bin).
// Байты лежат в IndexedDB этого браузера, имя и разрядность — в localStorage ('mq.local'), чтобы студия знала о модели
// до загрузки (seed по умолчанию, меню). Выбрана ли она сейчас — 'mq.model' = 'local'. На сервер файл не уходит.

const DB = 'mq', STORE = 'files', KEY = 'local-model';

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
  });
}

// заголовок формата MQW3 (training/colab, export_bin): "MQW3", u32 версия, 8 × u32 формы, f32 rope_theta, f32 eps.
// Студия читает версии 1 (8 бит, scale на строку) и 3 (W4R)
export function readHeader(bytes) {
  if (bytes.length < 48 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'MQW3') throw new Error('not-mqw3');
  const v = new DataView(bytes.buffer, bytes.byteOffset, 48);
  const u = (i) => v.getUint32(4 + 4 * i, true);
  const version = u(0);
  if (version !== 1 && version !== 3) throw new Error('version');
  const h = { bits: version === 1 ? 8 : 4, vocab: u(1), hidden: u(2), inter: u(3), layers: u(4), heads: u(5), kvHeads: u(6), headDim: u(7) };
  const attn = h.hidden * h.heads * h.headDim * 2 + h.hidden * h.kvHeads * h.headDim * 2 + 2 * h.headDim;
  h.params = h.vocab * h.hidden + h.layers * (attn + 3 * h.hidden * h.inter + 2 * h.hidden) + h.hidden;
  return h;
}

export function localMeta() {
  try { return JSON.parse(localStorage.getItem('mq.local') || 'null'); } catch { return null; }
}
export function localActive() {
  try { return localStorage.getItem('mq.model') === 'local' && !!localMeta(); } catch { return false; }
}
export function setLocalActive(on) {
  try {
    if (on) { localStorage.setItem('mq.model', 'local'); localStorage.setItem('mq.bits', String(localMeta().bits)); }
    else localStorage.removeItem('mq.model');
  } catch { /* без localStorage своя модель не держится между загрузками */ }
}
export async function saveLocal(name, bytes) {
  const h = readHeader(bytes);
  await tx('readwrite', (s) => s.put(bytes, KEY));
  localStorage.setItem('mq.local', JSON.stringify({ name, bits: h.bits, params: h.params, size: bytes.length }));
  return h;
}
export async function readLocal() {
  const b = await tx('readonly', (s) => s.get(KEY));
  return b ? new Uint8Array(b) : null;
}
