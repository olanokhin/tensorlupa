// Подложка 3D-сцен: мелкая точечная сетка, едва заметное зерно и два мягких свечения. Без неё за стеклянными
// пластинами ровная темнота и стекло не читается; с ней точки сквозь стекло светлее и подкрашены.
// Рисуется в размер холста (в физических пикселях), поэтому точки чёткие; пересоздаётся при ресайзе.
import * as THREE from 'three';

export function setBackdrop(scene, w, h, dpr) {
  const W = Math.max(2, Math.round(w * dpr)), H = Math.max(2, Math.round(h * dpr));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#111317'; g.fillRect(0, 0, W, H);
  const glow = (x, y, r, col) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  };
  glow(W * 0.18, H * 0.05, Math.max(W, H) * 0.6, 'rgba(242,179,61,0.055)');
  glow(W * 0.92, H * 1.0, Math.max(W, H) * 0.65, 'rgba(169,140,240,0.07)');
  // точечная сетка: шаг 18 css-пикселей
  const step = 18 * dpr, r = Math.max(0.9, 1.05 * dpr);
  g.fillStyle = 'rgba(200,210,230,0.14)';
  for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) { g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); }
  // зерно
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 7; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  if (scene.background && scene.background.dispose) scene.background.dispose();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}
