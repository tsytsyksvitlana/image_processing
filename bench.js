'use strict';

/* ------------------------------------------------------------------
 * Лаб. 3: бенчмарк продуктивності. Вимірює час виконання реального
 * конвеєра обробки одного зображення (LabCore.toGray → differenceImage →
 * cumulativeHistogram, ті самі функції, що й у algorithm.js/Lab2.inspect)
 * для реальних фото різної роздільної здатності.
 *
 * Навмисно НЕ є частиною інтерфейсу застосунку (index.html) — це
 * допоміжний dev-інструмент для збору даних до звіту лабораторної 3,
 * як test.js для лабораторної 1-2.
 * ------------------------------------------------------------------ */

const SIZE = LabCore.SIZE;           // 256 — усі зображення зводяться до цього розміру (як у виробничому коді)
const BINS = 64;
const RUNS = 5;

// Еталон для різниці: фіксований «синтетичний» градієнт SIZE×SIZE. Беремо його
// одним і тим самим для всіх вимірювань, щоб порівнювати лише вплив розміру
// вхідного файлу, а не вмісту еталона.
const reference = (() => {
  const g = new Uint8ClampedArray(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) g[y * SIZE + x] = ((x + y) / (2 * SIZE)) * 255;
  return g;
})();

const canvas = document.createElement('canvas');
canvas.width = canvas.height = SIZE;
const ctx = canvas.getContext('2d', { willReadFrequently: true });

function median(arr) {
  const s = [...arr].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function stats(arr) {
  return { runs: arr, min: Math.min(...arr), max: Math.max(...arr), mean: arr.reduce((a, b) => a + b, 0) / arr.length, median: median(arr) };
}

// Один прогін: decode+resize+grayscale (toGray, еквівалент loadGray у app.js) окремо
// від diff+histogram (сама «алгоритмічна» частина), щоб видно було, що саме домінує.
function runOnce(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const t0 = performance.now();
    img.onload = () => {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const gray = LabCore.toGray(ctx.getImageData(0, 0, SIZE, SIZE).data);
      const tDecode = performance.now() - t0;

      const t1 = performance.now();
      const diff = LabCore.differenceImage(reference, gray);
      const hist = LabCore.cumulativeHistogram(diff, BINS);
      const tProcess = performance.now() - t1;

      URL.revokeObjectURL(url);
      resolve({ decode: tDecode, process: tProcess, total: tDecode + tProcess, histSum: hist[BINS - 1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

async function benchFile(name, url) {
  const res = await fetch(url);               // лише щоб отримати Blob; мережевий час НЕ входить у вимірювання
  const blob = await res.blob();
  const bytes = blob.size;

  const decode = [], process = [], total = [];
  let w = 0, h = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = await runOnce(blob);
    decode.push(r.decode); process.push(r.process); total.push(r.total);
  }
  // натуральна роздільна здатність (для таблиці — наскільки великий файл реально був)
  await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { w = img.naturalWidth; h = img.naturalHeight; resolve(); };
    img.src = URL.createObjectURL(blob);
  });

  return { name, width: w, height: h, megapixels: (w * h) / 1e6, bytes, decode: stats(decode), process: stats(process), total: stats(total) };
}

function fmt(n) { return n.toFixed(2); }

function renderTable(results) {
  const rows = results.map((r) => `
    <tr>
      <td>${r.name}</td>
      <td>${r.width}×${r.height}</td>
      <td>${r.megapixels.toFixed(2)} Мп</td>
      <td>${(r.bytes / 1024).toFixed(0)} КБ</td>
      ${r.total.runs.map((v) => `<td>${fmt(v)}</td>`).join('')}
      <td><b>${fmt(r.total.mean)}</b></td>
      <td>${fmt(r.total.median)}</td>
      <td>${fmt(r.decode.mean)}</td>
      <td>${fmt(r.process.mean)}</td>
    </tr>`).join('');
  $('results').innerHTML = `
    <table class="bench-table">
      <thead><tr>
        <th>Зображення</th><th>Роздільна здатність</th><th>Пікселів</th><th>Розмір файлу</th>
        ${Array.from({ length: RUNS }, (_, i) => `<th>Запуск ${i + 1}</th>`).join('')}
        <th>Середній, мс</th><th>Медіана, мс</th><th>decode, мс</th><th>process, мс</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function drawChart(results) {
  const c = $('chart'); const cx = c.getContext('2d');
  const W = c.width, H = c.height, L = 56, R = 16, T = 16, B = 36;
  cx.clearRect(0, 0, W, H);
  const xs = results.map((r) => r.megapixels), ys = results.map((r) => r.total.mean);
  const xMax = Math.max(...xs) * 1.08, yMax = Math.max(...ys) * 1.15;
  const X = (v) => L + (v / xMax) * (W - L - R), Y = (v) => T + (H - T - B) - (v / yMax) * (H - T - B);

  cx.strokeStyle = '#8882'; cx.beginPath(); cx.moveTo(L, T); cx.lineTo(L, H - B); cx.lineTo(W - R, H - B); cx.stroke();
  cx.fillStyle = '#888'; cx.font = '11px sans-serif';
  cx.fillText('Мп (мегапікселі)', W / 2 - 40, H - 6);
  cx.save(); cx.translate(14, H / 2 + 30); cx.rotate(-Math.PI / 2); cx.fillText('час, мс (середнє)', 0, 0); cx.restore();

  cx.strokeStyle = '#4a90d9'; cx.lineWidth = 2; cx.beginPath();
  results.forEach((r, i) => { const x = X(r.megapixels), y = Y(r.total.mean); i ? cx.lineTo(x, y) : cx.moveTo(x, y); });
  cx.stroke();
  cx.fillStyle = '#4a90d9';
  results.forEach((r) => {
    const x = X(r.megapixels), y = Y(r.total.mean);
    cx.beginPath(); cx.arc(x, y, 3.5, 0, 7); cx.fill();
    cx.fillStyle = '#333'; cx.fillText(r.name, x - 10, y - 8); cx.fillStyle = '#4a90d9';
  });
}

function toMarkdown(results) {
  const head = `| Зображення | Роздільна здатність | Пікселів | Розмір файлу | ${Array.from({ length: RUNS }, (_, i) => `Запуск ${i + 1}`).join(' | ')} | Середній, мс | Медіана, мс |`;
  const sep = `|---|---|---|---|${Array.from({ length: RUNS }, () => '---').join('|')}|---|---|`;
  const rows = results.map((r) => `| ${r.name} | ${r.width}×${r.height} | ${r.megapixels.toFixed(2)} Мп | ${(r.bytes / 1024).toFixed(0)} КБ | ${r.total.runs.map(fmt).join(' | ')} | ${fmt(r.total.mean)} | ${fmt(r.total.median)} |`);
  return [head, sep, ...rows].join('\n');
}

const $ = (id) => document.getElementById(id);

async function runAll() {
  $('btn-run').disabled = true;
  $('status').textContent = 'Виконується…';
  const sources = JSON.parse($('sources').value);
  const results = [];
  for (const s of sources) {
    $('status').textContent = `Обробка: ${s.name}…`;
    results.push(await benchFile(s.name, s.url));
  }
  renderTable(results);
  drawChart(results);
  $('markdown').value = toMarkdown(results);
  window.benchResults = results;
  window.benchDone = true;           // прапорець для headless-автоматизації (--virtual-time-budget)
  $('status').textContent = 'Готово.';
  $('btn-run').disabled = false;
}

$('btn-run').addEventListener('click', runAll);
if (new URLSearchParams(location.search).has('autorun')) runAll();
