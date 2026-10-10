'use strict';

/* ------------------------------------------------------------------
 * Інтерфейс користувача (Лаб. 1) та його зв'язок з алгоритмом (Лаб. 2, algorithm.js).
 * Ознака зображення: кумулятивна гістограма яскравості РІЗНИЦЕВОГО зображення
 * |еталон − зображення|; класифікатор — Brain.js.
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const ALLOWED = ['image/png', 'image/jpeg', 'image/bmp'];
const MAX_FILE_MB = 5;
const CLASS_NAME = { ok: 'без дефекту', defect: 'з дефектом' };

const state = {
  reference: null,  // еталон (фігура без дефекту): { name, url, shape } — shape відомий лише для згенерованого
  samples: [],      // навчальні зображення: { id, name, label: 'ok'|'defect', url }
  selectedId: null, // вибране навчальне зображення
  tests: [],        // зображення для розпізнавання (без мітки): { id, name, url, truth, result }
  testSel: null,    // id вибраного зображення для розпізнавання
  nextId: 1,
  busy: false,
  trained: false,
  shownUrl: null,
};

/* Алгоритм (різниця з еталоном, кумулятивна гістограма, Brain.js) — у algorithm.js, об'єкт Lab2. */

/* ---------- Журнал і статус ---------- */
function log(msg, isErr = false) {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString('uk-UA')}  ${msg}`;
  if (isErr) li.className = 'err';
  $('log').prepend(li);
}

function setProgress(value, label) {
  $('progress').value = value;
  $('progress-label').textContent = label;
}

function setResult(kind, text, short) {
  const box = $('result');
  box.className = 'result' + (kind ? ' ' + kind : '');
  $('result-body').textContent = text;
  // той самий результат — плашкою на зображенні, щоб не шукати його в іншому блоці (для екранних читачів дублює блок «Результат», тому aria-hidden)
  const badge = $('preview-badge');
  badge.hidden = !kind;
  badge.className = 'res-badge' + (kind ? ' ' + kind : '');
  badge.textContent = kind ? short || text : '';
}

function showResult(r) {
  if (r) setResult(r.kind, r.text, r.short); else setResult('', 'Результату ще немає');
}

/* Після зміни даних чи параметрів навчання застаріває — про це має говорити і прогрес-бар */
function invalidateTraining(reason) {
  if (!state.trained) return;
  state.trained = false;
  Lab2.reset();
  setProgress(0, `Потрібно навчити заново (${reason})`);
  clearResults();
}

/* Результати належать мережі, яка їх видала: після її скидання вони втрачають сенс */
function clearResults() {
  state.tests.forEach((t) => { t.result = null; });
  if (state.testSel !== null) showResult(null);
  renderTests();
}

/* ---------- Мініатюри: спільна відмальовка для обох списків ---------- */
function revoke(url) {
  imgCache.delete(url);
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

function renderThumbs(ul, items, o) {
  // зберігаємо фокус, якщо він був усередині списку (перемальовка не має «губити» клавіатурного користувача)
  const active = document.activeElement;
  const focused = ul.contains(active) ? active.closest('.thumb') : null;
  const oldIdx = focused ? [...ul.querySelectorAll('.thumb')].indexOf(focused) : -1;
  const oldId = focused ? focused.dataset.id : null;

  ul.innerHTML = '';
  if (!items.length) {
    const ph = document.createElement('li');
    ph.className = 'placeholder'; ph.setAttribute('role', 'presentation'); ph.textContent = o.empty;
    ul.appendChild(ph);
  }
  const built = items.map((it) => {
    const li = document.createElement('li');
    li.className = `thumb ${o.cls(it)}` + (o.selected(it) ? ' selected' : '');
    li.dataset.id = it.id;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', o.selected(it) ? 'true' : 'false');
    li.setAttribute('aria-label', o.label(it));
    li.title = o.label(it);
    li.tabIndex = -1;
    const tag = o.tag ? o.tag(it) : '';
    li.innerHTML = `<img alt="" src="${it.url}">${tag ? `<span class="tag">${tag}</span>` : ''}`;
    // × — для миші; з клавіатури елемент видаляється клавішею Delete
    const del = document.createElement('button');
    del.className = 'del'; del.type = 'button'; del.textContent = '×'; del.title = 'Видалити';
    del.tabIndex = -1; del.setAttribute('aria-hidden', 'true');
    del.addEventListener('click', (e) => { e.stopPropagation(); o.onRemove(it.id); });
    li.appendChild(del);
    li.addEventListener('click', () => o.onSelect(it.id));
    ul.appendChild(li);
    return li;
  });

  // roving tabindex: у списку одна зупинка Tab, далі — стрілки
  let stop = built.find((li) => li.classList.contains('selected')) || built[0];
  if (focused) stop = built.find((li) => li.dataset.id === oldId) || built[Math.min(oldIdx, built.length - 1)] || stop;
  if (stop) stop.tabIndex = 0;
  if (focused && stop) stop.focus({ preventScroll: true });
}

function attachGridKeys(ul, { select, remove }) {
  ul.addEventListener('keydown', (e) => {
    const li = e.target.closest('.thumb');
    if (!li) return;
    const items = [...ul.querySelectorAll('.thumb')];
    const i = items.indexOf(li);
    const cols = items.filter((x) => x.offsetTop === items[0].offsetTop).length || 1;
    let n = i;
    switch (e.key) {
      case 'ArrowRight': n = i + 1; break;
      case 'ArrowLeft': n = i - 1; break;
      case 'ArrowDown': n = i + cols; break;
      case 'ArrowUp': n = i - cols; break;
      case 'Home': n = 0; break;
      case 'End': n = items.length - 1; break;
      case 'Enter': case ' ': e.preventDefault(); select(Number(li.dataset.id)); return;
      case 'Delete': case 'Backspace': e.preventDefault(); remove(Number(li.dataset.id)); return;
      default: return;
    }
    e.preventDefault();
    n = Math.max(0, Math.min(items.length - 1, n));
    items.forEach((x, k) => { x.tabIndex = k === n ? 0 : -1; });
    items[n].focus();
    items[n].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

/* ---------- Навчальний набір ---------- */
function addSample(name, label, url, meta) {
  const s = { id: state.nextId++, name, label, url, meta };
  state.samples.push(s);
  return s;
}

function renderDataset() {
  renderThumbs($('dataset'), state.samples, {
    cls: (s) => s.label,
    selected: (s) => s.id === state.selectedId,
    label: (s) => `${s.name}, ${CLASS_NAME[s.label]}`,
    tag: (s) => (s.label === 'ok' ? 'норма' : 'дефект'),
    onSelect: select,
    onRemove: removeSample,
    empty: 'Набір порожній. Завантажте файли або згенеруйте приклади.',
  });
  $('counter').textContent = state.samples.length;
  updateButtons();
}

function removeSample(id) {
  const s = state.samples.find((x) => x.id === id);
  if (!s) return;
  state.samples = state.samples.filter((x) => x.id !== id);
  revoke(s.url);
  if (state.selectedId === id) { state.selectedId = null; clearPreview(); showResult(null); }
  invalidateTraining('набір даних змінено');
  renderDataset();
}

/* ---------- Перегляд зображення ---------- */
const imgCache = new Map();   // декодовані зображення, щоб не перемальовувати їх із затримкою

function drawPreview(img) {
  const c = $('preview'), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const k = Math.min(c.width / img.width, c.height / img.height);
  const w = img.width * k, h = img.height * k;
  ctx.imageSmoothingEnabled = k < 1;   // малі зображення збільшуємо без розмиття, щоб було видно пікселі
  ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
  $('preview').closest('.view').classList.add('filled');
}

function showImage(url, caption, meta) {
  state.shownUrl = url;
  state.shownMeta = meta || null;
  $('preview-name').textContent = caption;
  $('preview').setAttribute('aria-label', `Зображення: ${caption}`);
  $('info-toggle').disabled = false;
  updateInfoPanel();
  $('save-preview-btn').disabled = false;
  const cached = imgCache.get(url);
  if (cached) { drawPreview(cached); updateInfoPanel(); return; }
  const img = new Image();
  img.onload = () => { imgCache.set(url, img); if (state.shownUrl === url) { drawPreview(img); updateInfoPanel(); } };
  img.src = url;
}

/* Інформація про поточне зображення: формат, розмір файлу, роздільна здатність (методичка, п.5) */
function fileMeta(url, meta) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url);
  if (m) return { type: m[1], size: Math.round((m[2].length * 3) / 4) };
  return meta || { type: '', size: null };
}
const EXT_NAME = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/bmp': 'BMP' };

function updateInfoPanel() {
  const panel = $('info-panel');
  if (!state.shownUrl) { panel.hidden = true; return; }
  const { type, size } = fileMeta(state.shownUrl, state.shownMeta);
  const img = imgCache.get(state.shownUrl);
  const rows = [
    ['Розширення', EXT_NAME[type] || type || 'невідомо'],
    ['Розмір файлу', size != null ? `${(size / 1024).toFixed(1)} КБ` : '—'],
    ['Роздільна здатність', img ? `${img.width} × ${img.height} px` : 'завантажується…'],
  ];
  panel.innerHTML = `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

$('info-toggle').addEventListener('click', () => {
  const panel = $('info-panel'), open = panel.hidden;
  panel.hidden = !open;
  $('info-toggle').setAttribute('aria-expanded', String(open));
});

/* ---------- Збереження зображення (png/jpg/bmp — методичка, "Що аплікація має містити", п.2) ---------- */

// Canvas.toDataURL не підтримує image/bmp в жодному браузері, тому для BMP кодуємо вручну:
// 24-біт, без стиснення, рядки знизу вгору й вирівняні на 4 байти (стандартний формат BMP).
function canvasToBMPBlob(canvas) {
  const w = canvas.width, h = canvas.height;
  const { data } = canvas.getContext('2d').getImageData(0, 0, w, h);
  const rowSize = Math.ceil((w * 3) / 4) * 4, pixelDataSize = rowSize * h, fileSize = 54 + pixelDataSize;
  const view = new DataView(new ArrayBuffer(fileSize));
  view.setUint8(0, 0x42); view.setUint8(1, 0x4D);               // 'BM'
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);                                  // зсув до пікселів
  view.setUint32(14, 40, true);                                  // розмір BITMAPINFOHEADER
  view.setInt32(18, w, true); view.setInt32(22, h, true);
  view.setUint16(26, 1, true); view.setUint16(28, 24, true);     // 1 площина, 24 біт/піксель
  view.setUint32(34, pixelDataSize, true);
  let p = 54;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      view.setUint8(p++, data[i + 2]); view.setUint8(p++, data[i + 1]); view.setUint8(p++, data[i]);   // BGR
    }
    p += rowSize - w * 3;   // вирівнювання рядка
  }
  return new Blob([view.buffer], { type: 'image/bmp' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveCanvas(canvas, format, baseName) {
  if (format === 'bmp') { downloadBlob(canvasToBMPBlob(canvas), `${baseName}.bmp`); return; }
  let src = canvas;
  if (format === 'jpg') {   // JPEG не має прозорості — підкладаємо білий фон, інакше вийде чорним
    src = document.createElement('canvas');
    src.width = canvas.width; src.height = canvas.height;
    const ctx = src.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, src.width, src.height); ctx.drawImage(canvas, 0, 0);
  }
  const a = document.createElement('a');
  a.href = src.toDataURL(format === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
  a.download = `${baseName}.${format}`;
  a.click();
}

for (const [canvasId, fmtId, btnId, base] of [
  ['preview', 'save-preview-fmt', 'save-preview-btn', 'зображення'],
  ['diff', 'save-diff-fmt', 'save-diff-btn', 'різниця'],
  ['hist', 'save-hist-fmt', 'save-hist-btn', 'гістограма'],
]) {
  $(btnId).addEventListener('click', () => {
    saveCanvas($(canvasId), $(fmtId).value, base);
    log(`Збережено «${base}» у форматі ${$(fmtId).value.toUpperCase()}`);
  });
}

function select(id) {
  if (state.selectedId === id) return;
  state.selectedId = id; state.testSel = null;
  const s = state.samples.find((x) => x.id === id);
  showImage(s.url, `${s.name} · навчальне, ${CLASS_NAME[s.label]}`, s.meta);
  showResult(null); clearHist(); showFeatures(s.url);
  renderDataset(); renderTests();
}

function clearPreview() {
  state.shownUrl = null;
  state.shownMeta = null;
  const c = $('preview');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
  $('preview').closest('.view').classList.remove('filled');
  $('preview-name').textContent = '—';
  $('preview').setAttribute('aria-label', 'Зображення не вибрано');
  $('info-toggle').disabled = true;
  $('info-panel').hidden = true;
  $('info-toggle').setAttribute('aria-expanded', 'false');
  $('save-preview-btn').disabled = true;
  clearHist();
}

/* Різницеве зображення та кумулятивна гістограма вибраного зображення */
function drawDiff(imageData) {
  const tmp = document.createElement('canvas');
  tmp.width = imageData.width; tmp.height = imageData.height;
  tmp.getContext('2d').putImageData(imageData, 0, 0);
  const c = $('diff'), ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, c.width, c.height);
  c.closest('.view').classList.add('filled');
  c.setAttribute('aria-label', 'Різницеве зображення: світлі пікселі відрізняються від еталона');
  $('save-diff-btn').disabled = false;
}

function drawHist(h) {
  const c = $('hist'), ctx = c.getContext('2d'), css = getComputedStyle(document.documentElement);
  const W = c.width, H = c.height, L = 96, R = 24, T = 24, B = 56, w = W - L - R, hgt = H - T - B;
  ctx.clearRect(0, 0, W, H);
  ctx.font = '15px system-ui, sans-serif';
  const last = h[h.length - 1] * 100;
  // верхня межа осі — «кругле» число, щоб криві різних зображень легко порівнювати на око
  const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].find((v) => v >= last) || 100, top = Math.max(nice, 0.1);
  ctx.strokeStyle = css.getPropertyValue('--line'); ctx.fillStyle = css.getPropertyValue('--muted'); ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) {
    const y = T + hgt - (hgt * k) / 4;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
    ctx.fillText(`${+(top * k / 4).toPrecision(2)}%`, L - 8, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let k = 0; k <= 4; k++) ctx.fillText(String(Math.round(255 * k / 4)), L + (w * k) / 4, T + hgt + 8);
  ctx.fillText('яскравість різниці (0–255)', L + w / 2, T + hgt + 30);
  ctx.save(); ctx.translate(18, T + hgt / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle';
  ctx.fillText('частка пікселів, накопичена', 0, 0); ctx.restore();

  const n = h.length, x = (i) => L + (n === 1 ? 0 : (w * i) / (n - 1)), y = (v) => T + hgt - (hgt * v * 100) / top;
  ctx.strokeStyle = last > 0 ? css.getPropertyValue('--bad') : css.getPropertyValue('--ok'); ctx.lineWidth = 3;
  ctx.beginPath();
  h.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();
  c.closest('.view').classList.add('filled');
  c.setAttribute('aria-label', last > 0
    ? `Кумулятивна гістограма: змінено ${last.toFixed(2)}% пікселів`
    : 'Кумулятивна гістограма: усі значення нульові, різниці з еталоном немає');
  $('save-hist-btn').disabled = false;
}

function drawFeatures(f) { drawDiff(f.diff); drawHist(f.histogram); }

/* Ознаки навчального зображення показуємо одразу при виборі; для зображень без мітки — лише після розпізнавання */
async function showFeatures(url) {
  if (!state.reference) return;
  const bins = Number($('bins').value);
  const f = await Lab2.inspect(url, state.reference.url, Number.isInteger(bins) && bins >= 4 && bins <= 256 ? bins : 256).catch(() => null);
  if (f && state.shownUrl === url) drawFeatures(f);
}

function clearHist() {   // ознаки (різниця та гістограма) належать вибраному зображенню
  for (const id of ['diff', 'hist']) {
    const c = $(id);
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    c.closest('.view').classList.remove('filled');
  }
  $('save-diff-btn').disabled = true;
  $('save-hist-btn').disabled = true;
}

/* ---------- Зображення для розпізнавання (без мітки) ---------- */
function addTest(name, url, truth, meta) {
  // truth — справжній клас (відомий лише для згенерованих зображень), потрібен для перевірки результату в Лаб. 2
  const t = { id: state.nextId++, name, url, truth, result: null, meta };
  state.tests.push(t);
  return t;
}

function selectTest(id) {
  if (state.testSel === id) return;   // повторний клік не перемальовує зображення
  state.testSel = id; state.selectedId = null;
  const t = state.tests.find((x) => x.id === id);
  showImage(t.url, `${t.name} · для розпізнавання (мітки немає)`, t.meta);
  showResult(t.result); clearHist();
  if (t.result && t.result.feat) drawFeatures(t.result.feat);
  renderDataset(); renderTests();
}

function removeTest(id) {
  const t = state.tests.find((x) => x.id === id);
  if (!t) return;
  state.tests = state.tests.filter((x) => x.id !== id);
  revoke(t.url);
  if (state.testSel === id) { state.testSel = null; clearPreview(); showResult(null); }
  renderTests();
}

function renderTests() {
  renderThumbs($('tests'), state.tests, {
    cls: (t) => (t.result ? 'done' + (t.result.kind ? ' res-' + t.result.kind : '') : ''),
    selected: (t) => t.id === state.testSel,
    label: (t) => `${t.name}, для розпізнавання${t.result ? ', розпізнано' + (t.result.short ? ': ' + t.result.short : '') : ''}`,
    onSelect: selectTest,
    onRemove: removeTest,
    empty: 'Немає зображень. Завантажте файл або згенеруйте випадкове.',
  });
  $('test-counter').textContent = state.tests.length;
  updateButtons();
}

/* ---------- Кнопки: доступність за станом + видимі пояснення ---------- */
function setHint(id, text) {
  const el = $(id);
  el.textContent = text;
  el.hidden = !text;
}

function updateButtons() {
  const hasOk = state.samples.some((s) => s.label === 'ok');
  const hasDefect = state.samples.some((s) => s.label === 'defect');
  const canTrain = hasOk && hasDefect && !!state.reference;
  $('btn-train').disabled = state.busy || !canTrain;
  setHint('hint-train', state.busy || canTrain ? '' : !state.reference ? 'Спершу задайте еталон' : 'Потрібен хоча б один приклад кожного класу');

  const noTest = state.testSel === null;
  $('btn-classify').disabled = state.busy || noTest || !state.trained;
  setHint('hint-classify', state.busy ? '' : noTest ? 'Оберіть зображення для розпізнавання' : !state.trained ? 'Спершу навчіть мережу' : '');

  $('btn-gen-test').disabled = state.busy;
  $('btn-clear').disabled = state.busy || !state.samples.length;
  $('btn-generate').disabled = state.busy;
  $('btn-gen-ref').disabled = state.busy;

  // акцентом виділено лише наступну дію: користувач бачить, що натискати далі
  const t = state.tests.find((x) => x.id === state.testSel);
  const next = state.busy ? null
    : !canTrain ? 'btn-generate'
    : !state.trained ? 'btn-train'
    : !state.tests.length ? 'btn-gen-test'
    : t && !t.result ? 'btn-classify' : null;
  for (const id of ['btn-generate', 'btn-train', 'btn-gen-test', 'btn-classify']) $(id).classList.toggle('primary', id === next);
}

/* ---------- Завантаження файлів ---------- */
function checkFiles(fileList) {
  const ok = [], errors = [];
  for (const f of fileList) {
    if (!ALLOWED.includes(f.type)) errors.push(`«${f.name}»: непідтримуваний формат (${f.type || 'невідомо'})`);
    else if (f.size > MAX_FILE_MB * 1024 * 1024) errors.push(`«${f.name}»: більше ${MAX_FILE_MB} МБ`);
    else ok.push(f);
  }
  return { ok, errors };
}

function showDropError(id, errors) {
  errors.forEach((m) => log(m, true));
  $(id).textContent = errors.length ? (errors.length === 1 ? errors[0] : `${errors[0]} та ще ${errors.length - 1}`) : '';
}

function handleFiles(fileList) {
  if (state.busy) return;
  const label = document.querySelector('input[name=cls]:checked').value;
  const { ok, errors } = checkFiles(fileList);
  showDropError('err-train-drop', errors);
  if (!ok.length) return;
  ok.forEach((f) => addSample(f.name, label, URL.createObjectURL(f), { size: f.size, type: f.type }));
  invalidateTraining('набір даних змінено');
  log(`Завантажено ${ok.length} файл(ів) як «${CLASS_NAME[label]}»`);
  renderDataset();
}

function handleTestFiles(fileList) {
  if (state.busy) return;
  const { ok, errors } = checkFiles(fileList);
  showDropError('err-test-drop', errors);
  if (!ok.length) return;
  const added = ok.map((f) => addTest(f.name, URL.createObjectURL(f), null, { size: f.size, type: f.type }));
  log(`Додано для розпізнавання: ${added.length} файл(ів)`);
  renderTests();
  selectTest(added[0].id);
}

function setupDropzone(zone, input, handler) {
  input.addEventListener('change', () => { handler(input.files); input.value = ''; });
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => handler(e.dataTransfer.files));
}
setupDropzone($('dropzone'), $('file-input'), handleFiles);
setupDropzone($('test-drop'), $('test-input'), handleTestFiles);

// файл, відпущений повз зону, не має відкриватися в цій вкладці (це б знищило стан застосунку)
['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));

/* зона 1 показує, з яким класом буде завантажено файли */
function updateDropCls() {
  const label = document.querySelector('input[name=cls]:checked').value;
  $('drop-cls').innerHTML = `Завантажується як: <b>${CLASS_NAME[label]}</b>`;
}
document.querySelectorAll('input[name=cls]').forEach((r) => r.addEventListener('change', updateDropCls));

/* ---------- Завантаження цілої папки: групування за підпапками (якість) та розширенням ---------- */
// webkitRelativePath кожного файлу має вигляд "коренева_папка/підпапка/.../файл.ext"
let folderFiles = [];   // { file, topSub, ext }

function extOf(name) { const m = /\.([^.]+)$/.exec(name); return m ? m[1].toLowerCase() : '?'; }

$('btn-folder-pick').addEventListener('click', () => $('folder-input').click());

$('folder-input').addEventListener('change', () => {
  const files = [...$('folder-input').files];
  $('folder-input').value = '';
  if (!files.length) return;
  const root = files[0].webkitRelativePath.split('/')[0];
  folderFiles = files.map((f) => {
    const parts = f.webkitRelativePath.split('/');
    return { file: f, topSub: parts.length > 2 ? parts[1] : null, ext: extOf(f.name) };
  });

  const bySub = new Map();   // підпапка → кількість (для списку областей вибору)
  for (const x of folderFiles) { const k = x.topSub || ''; bySub.set(k, (bySub.get(k) || 0) + 1); }

  const sel = $('folder-scope');
  sel.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = ''; optAll.textContent = `Уся папка «${root}» (${folderFiles.length})`;
  sel.append(optAll);
  for (const [sub, n] of bySub) {
    if (!sub) continue;   // файли прямо в корені вже враховані в "Уся папка"
    const o = document.createElement('option');
    o.value = sub; o.textContent = `${sub} (${n})`;
    sel.append(o);
  }
  $('folder-panel').hidden = false;
  updateFolderBreakdown();
  log(`Обрано папку «${root}»: ${folderFiles.length} файл(ів)${bySub.size > 1 ? `, підпапок: ${bySub.size - (bySub.has('') ? 1 : 0)}` : ''}`);
});

function filesInScope() {
  const scope = $('folder-scope').value;
  return scope ? folderFiles.filter((x) => x.topSub === scope) : folderFiles;
}

// розбивка за розширенням для обраної області — саме це вимагає методичка ("погруповані за розширенням та якістю")
function updateFolderBreakdown() {
  const byExt = new Map();
  for (const x of filesInScope()) byExt.set(x.ext, (byExt.get(x.ext) || 0) + 1);
  $('folder-breakdown').textContent = byExt.size
    ? `За розширенням: ${[...byExt].map(([ext, n]) => `${ext.toUpperCase()} — ${n}`).join(', ')}`
    : 'У цій області файлів немає';
}
$('folder-scope').addEventListener('change', updateFolderBreakdown);

$('btn-folder-add').addEventListener('click', () => {
  if (state.busy) return;
  const label = document.querySelector('input[name=cls]:checked').value;
  const scopeFiles = filesInScope().map((x) => x.file);
  const { ok, errors } = checkFiles(scopeFiles);
  showDropError('err-train-drop', errors);
  if (!ok.length) return;
  ok.forEach((f) => addSample(f.name, label, URL.createObjectURL(f), { size: f.size, type: f.type }));
  invalidateTraining('набір даних змінено');
  const scopeName = $('folder-scope').selectedOptions[0].textContent;
  log(`Додано з «${scopeName}»: ${ok.length} файл(ів) як «${CLASS_NAME[label]}»`);
  renderDataset();
});

/* ---------- Генератор зображень ---------- */
function drawShape(ctx, shape, cx, cy, r) {
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(cx, cy, r, 0, Math.PI * 2);
  else ctx.rect(cx - r, cy - r, r * 2, r * 2);
  ctx.fill();
}

// Кілька випадкових пікселів-«шуму» (сенсор/стиснення). Додається до обох класів однаково, тож
// «норма» в тренувальних даних більше не рівно 0 — мережа має на чому побудувати запас від дефекту,
// а не ставити межу впритул до нуля (див. обговорення різниці еталон/навчальний набір).
function addNoise(ctx, S, count) {
  const data = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < count; i++) {
    const p = (Math.floor(Math.random() * S * S)) * 4;
    const v = data.data[p] === 0 ? 255 : 0;   // інвертуємо піксель незалежно від того, фігура це чи фон
    data.data[p] = data.data[p + 1] = data.data[p + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
}

function generateImage(shape, defect, noise = true) {
  const S = 256, c = document.createElement('canvas');   // 256×256: на екрані піксель ≈ піксель, край без «сходинок»
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#000';
  // фігура завжди на одному місці й одного розміру: метод порівнює зображення з еталоном піксель до пікселя,
  // тож зсув чи інший радіус дали б різницю й без дефекту
  const r = 70, cx = S / 2, cy = S / 2;
  drawShape(ctx, shape, cx, cy, r);
  if (defect) {
    // невелика «висяча» ділянка на межі фігури
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      // центр плями — строго на межі фігури, тож принаймні половина плями видима (інакше «дефект» міг
      // цілком опинитись усередині квадрата й не змінити зображення)
      let px, py;
      if (shape === 'circle') {
        const a = Math.random() * Math.PI * 2;
        px = cx + Math.cos(a) * r; py = cy + Math.sin(a) * r;
      } else {
        const u = (Math.random() * 2 - 1) * r;
        [px, py] = [[cx + u, cy - r], [cx + r, cy + u], [cx + u, cy + r], [cx - r, cy + u]][Math.floor(Math.random() * 4)];
      }
      const pr = 6 + Math.random() * 8;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (noise) addNoise(ctx, S, 15 + Math.floor(Math.random() * 15));   // 15–30 пікселів ≈ 0.02–0.045% — набагато менше за дефект
  return c.toDataURL('image/png');
}

/* ---------- Еталон ---------- */
const SHAPE_NAME = { circle: 'круг', square: 'квадрат' };

function setReference(name, url, shape) {
  if (state.reference) revoke(state.reference.url);
  state.reference = { name, url, shape };
  $('ref-img').src = url;
  $('ref-img').hidden = false;
  $('ref-ph').hidden = true;
  $('ref-drop').classList.add('has');
  const text = shape ? `${SHAPE_NAME[shape]} (згенеровано)` : name;
  $('ref-info').textContent = `Еталон: ${text}`;
  $('ref-drop').setAttribute('aria-label', `Еталон: ${text}. Натисніть, щоб замінити файлом`);
  invalidateTraining('еталон змінено');
  updateButtons();
}

function generateReference(shape, auto) {
  setReference(`еталон_${SHAPE_NAME[shape]}`, generateImage(shape, false, false), shape);
  log(`${auto ? 'Еталон створено автоматично' : 'Згенеровано еталон'}: ${SHAPE_NAME[shape]}`);
}

function handleRefFiles(fileList) {
  if (state.busy) return;
  const { ok, errors } = checkFiles(fileList);
  showDropError('err-ref', errors);
  if (!ok.length) return;
  setReference(ok[0].name, URL.createObjectURL(ok[0]), null);
  log(`Еталон: «${ok[0].name}»${ok.length > 1 ? ` (з ${ok.length} файлів використано перший)` : ''}`);
}

setupDropzone($('ref-drop'), $('ref-input'), handleRefFiles);
$('btn-gen-ref').addEventListener('click', () => { showDropError('err-ref', []); generateReference($('shape').value, false); });

function validateCount(report) {
  const raw = $('count').value.trim(), n = Number(raw);
  const bad = raw === '' || !Number.isInteger(n) || n < 1 || n > 1000;
  $('count').setAttribute('aria-invalid', bad ? 'true' : 'false');
  $('count-err').textContent = bad ? 'Введіть ціле число від 1 до 1000' : '';
  if (bad && report) { log('Кількість прикладів має бути цілим числом від 1 до 1000', true); $('count').focus(); }
  return bad ? null : n;
}
$('count').addEventListener('input', () => validateCount(false));

const GEN_CHUNK = 20;   // після кожних N фігур віддаємо кадр, щоб прогрес-бар і UI не завмирали при великих count

$('btn-generate').addEventListener('click', async () => {
  const n = validateCount(true), shape = $('shape').value;
  if (n === null) return;
  const name = SHAPE_NAME[shape];
  setBusy(true);
  setProgress(0, 'Генерація…');
  const t0 = performance.now();
  // навчальні зображення порівнюються з еталоном тієї самої фігури; власний (завантажений) еталон не чіпаємо
  if (!state.reference || (state.reference.shape && state.reference.shape !== shape)) generateReference(shape, true);
  for (let i = 0; i < n; i++) {
    addSample(`${name}_норма_${i + 1}`, 'ok', generateImage(shape, false));
    addSample(`${name}_дефект_${i + 1}`, 'defect', generateImage(shape, true));
    if (i % GEN_CHUNK === GEN_CHUNK - 1 || i === n - 1) {
      const p = Math.round((100 * (i + 1)) / n);
      setProgress(p, `Генерація… ${p}%`);
      await new Promise((r) => setTimeout(r, 0));   // віддаємо кадр: перемальовка + реакція на клік "скасувати" тощо
    }
  }
  const seconds = (performance.now() - t0) / 1000;
  invalidateTraining('набір даних змінено');
  log(`Згенеровано ${n * 2} зображень (${name}): ${n} без дефекту, ${n} з дефектом за ${seconds.toFixed(2)} с`);
  setProgress(100, `Генерація завершена за ${seconds.toFixed(2)} с`);
  renderDataset();
  setBusy(false);
});

let testCounter = 0;
$('btn-gen-test').addEventListener('click', () => {
  const shape = (state.reference && state.reference.shape) || $('shape').value, defect = Math.random() < 0.5;
  const t = addTest(`тестове_${++testCounter}`, generateImage(shape, defect), defect ? 'defect' : 'ok');
  renderTests();
  selectTest(t.id);
  log('Згенеровано випадкове зображення для розпізнавання (клас не показується)');
});

$('btn-clear').addEventListener('click', () => {
  if (!confirm('Видалити всі зображення з навчального набору?')) return;
  const wasShown = state.selectedId !== null;
  state.samples.forEach((s) => revoke(s.url));
  state.samples = []; state.selectedId = null; state.trained = false; Lab2.reset();
  clearResults();
  if (wasShown) { clearPreview(); showResult(null); }
  setProgress(0, 'Очікування');
  log('Навчальний набір очищено');
  renderDataset();
});

/* ---------- Параметри мережі: перевірка під час введення ---------- */
const PARAMS = [['bins', 'Інтервалів гістограми', 4, 256, true], ['hidden', 'Нейронів у прихованому шарі', 0, 64, true],
                ['epochs', 'Епох навчання', 1, 10000, true], ['lr', 'Швидкість навчання', 0.001, 1, false]];

function validateParams(report) {
  const p = {};
  let first = null;
  for (const [id, title, min, max, int] of PARAMS) {
    const raw = $(id).value.trim(), v = Number(raw);
    const bad = raw === '' || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v));
    $(id).setAttribute('aria-invalid', bad ? 'true' : 'false');
    if (bad && !first) first = { id, msg: `«${title}»: допустимі значення ${min}–${max}${int ? ' (ціле число)' : ''}` };
    p[id] = v;
  }
  $('params-err').textContent = first ? first.msg : '';
  if (first && report) { log(first.msg, true); $(first.id).focus(); }
  return first ? null : p;
}

for (const [id] of PARAMS) {
  $(id).addEventListener('input', () => { validateParams(false); invalidateTraining('параметри змінено'); updateButtons(); });
}

function setBusy(b) {
  state.busy = b;
  document.querySelectorAll('input, select').forEach((el) => { el.disabled = b; });
  updateButtons();
}

/* ---------- Навчання та розпізнавання ---------- */
const pct = (m) => (m ? `${(m.accuracy * 100).toFixed(0)}% (${m.tp + m.tn}/${m.n})` : '—');

async function trainNetwork() {
  const params = validateParams(true);
  if (!params) return;
  setBusy(true);
  setProgress(0, 'Навчання…');
  log(`Старт навчання: ${state.samples.length} зображень, еталон «${state.reference.name}», параметри ${JSON.stringify(params)}`);
  try {
    const r = await Lab2.train(state.samples, state.reference, params, (p) => setProgress(p, `Навчання… ${p}%`));
    setProgress(100, 'Навчання завершено');
    state.trained = true;
    log(`Ознаки обчислено за ${r.extract.seconds.toFixed(2)} с (${r.extract.inPool ? `пул із ${r.extract.workers} Worker'ів` : 'послідовно в головному потоці'})`);
    log(`Навчання завершено за ${r.seconds.toFixed(2)} с (${r.iterations} епох, похибка ${r.error.toFixed(4)}, ${r.inWorker ? 'Web Worker' : 'головний потік'})`);
    log(`Точність: навчальна ${pct(r.train)}, валідаційна ${pct(r.val)}${r.val ? `; TP=${r.val.tp} FP=${r.val.fp} TN=${r.val.tn} FN=${r.val.fn}` : ' (мало прикладів для валідації)'}`);
  } catch (e) {
    state.trained = false;
    setProgress(0, 'Помилка навчання');
    log(`Помилка навчання: ${e.message}`, true);
  }
  setBusy(false);
  $('btn-train').focus();   // кнопка на час навчання блокується, тож повертаємо фокус, щоб він не «загубився»
}
$('btn-train').addEventListener('click', trainNetwork);

$('btn-classify').addEventListener('click', async () => {
  const t = state.tests.find((x) => x.id === state.testSel);
  if (!t) return;
  let res;
  try { res = await Lab2.classify(t, state.reference); }
  catch (e) { log(`Помилка розпізнавання «${t.name}»: ${e.message}`, true); return; }
  if (!res) {
    t.result = { kind: '', text: 'Мережу ще не навчено' };
    log(`Розпізнавання «${t.name}»: мережу ще не навчено`);
  } else {
    const name = res.label === 'ok' ? 'Без дефекту' : 'Є дефект', p = (res.confidence * 100).toFixed(0);
    // для згенерованих зображень справжній клас відомий — показуємо, чи мережа помилилась
    const check = t.truth ? (t.truth === res.label ? ' — вірно' : ` — ПОМИЛКА (насправді ${CLASS_NAME[t.truth]})`) : '';
    t.result = { kind: res.label, text: `${name} (впевненість ${p}%)${check}`, short: `${name} · ${p}%`, feat: { diff: res.diff, histogram: res.histogram } };
    log(`Розпізнавання «${t.name}»: ${name}, ${p}%${check}`);
    if (state.testSel === t.id) drawFeatures(t.result.feat);
  }
  showResult(t.result);
  renderTests();
});

/* ---------- Ініціалізація ---------- */
attachGridKeys($('dataset'), { select, remove: removeSample });
attachGridKeys($('tests'), { select: selectTest, remove: removeTest });

// режим нумерації для скріншотів: index.html?annotate
if (location.search.includes('annotate')) document.body.classList.add('annotate');

updateDropCls();
renderDataset();
renderTests();
log('Застосунок готовий до роботи');

// демо-режим для скріншотів: index.html?annotate&demo
if (location.search.includes('demo')) {
  $('count').value = 4;
  $('btn-generate').click();
  for (let k = 0; k < 4; k++) $('btn-gen-test').click();
  selectTest(state.tests[1].id);
  trainNetwork().then(() => { if (state.trained) $('btn-classify').click(); });
}
