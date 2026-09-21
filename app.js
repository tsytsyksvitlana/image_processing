'use strict';

/* ------------------------------------------------------------------
 * Лаб. 1: інтерфейс користувача.
 * Алгоритм буде підключено в Лаб. 2 через об'єкт Lab2 (див. нижче).
 * Ознака зображення: кумулятивна гістограма яскравості РІЗНИЦЕВОГО зображення
 * |еталон − зображення|; класифікатор — Brain.js. Інтерфейс змінювати не доведеться.
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

/* ---------- Заглушка алгоритму (замінити в Лаб. 2) ---------- */
const Lab2 = {
  // Навчання: для кожного зразка береться різниця з еталоном, її кумулятивна гістограма (params.bins рівнів)
  // подається на вхід мережі. Викликає onProgress(0..100). Зараз лише імітує прогрес.
  train(samples, reference, params, onProgress) {
    return new Promise((resolve) => {
      let p = 0;
      const t = setInterval(() => {
        p = Math.min(100, p + 4);
        onProgress(p);
        if (p >= 100) { clearInterval(t); resolve(); }
      }, 60);
    });
  },
  // Розпізнавання зображення без мітки: має повернути
  // { label: 'ok'|'defect', confidence: 0..1, histogram: number[], diff: ImageData }
  async classify(image, reference, params) {
    return null; // алгоритм ще не реалізовано
  },
};

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
function addSample(name, label, url) {
  const s = { id: state.nextId++, name, label, url };
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

function showImage(url, caption) {
  state.shownUrl = url;
  $('preview-name').textContent = caption;
  $('preview').setAttribute('aria-label', `Зображення: ${caption}`);
  const cached = imgCache.get(url);
  if (cached) { drawPreview(cached); return; }
  const img = new Image();
  img.onload = () => { imgCache.set(url, img); if (state.shownUrl === url) drawPreview(img); };
  img.src = url;
}

function select(id) {
  if (state.selectedId === id) return;
  state.selectedId = id; state.testSel = null;
  const s = state.samples.find((x) => x.id === id);
  showImage(s.url, `${s.name} · навчальне, ${CLASS_NAME[s.label]}`);
  showResult(null); clearHist();
  renderDataset(); renderTests();
}

function clearPreview() {
  state.shownUrl = null;
  const c = $('preview');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
  $('preview').closest('.view').classList.remove('filled');
  $('preview-name').textContent = '—';
  $('preview').setAttribute('aria-label', 'Зображення не вибрано');
  clearHist();
}

function clearHist() {   // ознаки (різниця та гістограма) належать вибраному зображенню
  for (const id of ['diff', 'hist']) {
    const c = $(id);
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    c.closest('.view').classList.remove('filled');
  }
}

/* ---------- Зображення для розпізнавання (без мітки) ---------- */
function addTest(name, url, truth) {
  // truth — справжній клас (відомий лише для згенерованих зображень), потрібен для перевірки результату в Лаб. 2
  const t = { id: state.nextId++, name, url, truth, result: null };
  state.tests.push(t);
  return t;
}

function selectTest(id) {
  if (state.testSel === id) return;   // повторний клік не перемальовує зображення
  state.testSel = id; state.selectedId = null;
  const t = state.tests.find((x) => x.id === id);
  showImage(t.url, `${t.name} · для розпізнавання (мітки немає)`);
  showResult(t.result); clearHist();
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
  ok.forEach((f) => addSample(f.name, label, URL.createObjectURL(f)));
  invalidateTraining('набір даних змінено');
  log(`Завантажено ${ok.length} файл(ів) як «${CLASS_NAME[label]}»`);
  renderDataset();
}

function handleTestFiles(fileList) {
  if (state.busy) return;
  const { ok, errors } = checkFiles(fileList);
  showDropError('err-test-drop', errors);
  if (!ok.length) return;
  const added = ok.map((f) => addTest(f.name, URL.createObjectURL(f), null));
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

/* ---------- Генератор зображень ---------- */
function drawShape(ctx, shape, cx, cy, r) {
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(cx, cy, r, 0, Math.PI * 2);
  else ctx.rect(cx - r, cy - r, r * 2, r * 2);
  ctx.fill();
}

function generateImage(shape, defect) {
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
      const a = Math.random() * Math.PI * 2, d = shape === 'circle' ? r : r * 1.05;
      const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d, pr = 6 + Math.random() * 8;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    }
  }
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
  setReference(`еталон_${SHAPE_NAME[shape]}`, generateImage(shape, false), shape);
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
  const bad = raw === '' || !Number.isInteger(n) || n < 1 || n > 50;
  $('count').setAttribute('aria-invalid', bad ? 'true' : 'false');
  $('count-err').textContent = bad ? 'Введіть ціле число від 1 до 50' : '';
  if (bad && report) { log('Кількість прикладів має бути цілим числом від 1 до 50', true); $('count').focus(); }
  return bad ? null : n;
}
$('count').addEventListener('input', () => validateCount(false));

$('btn-generate').addEventListener('click', () => {
  const n = validateCount(true), shape = $('shape').value;
  if (n === null) return;
  const name = SHAPE_NAME[shape];
  // навчальні зображення порівнюються з еталоном тієї самої фігури; власний (завантажений) еталон не чіпаємо
  if (!state.reference || (state.reference.shape && state.reference.shape !== shape)) generateReference(shape, true);
  for (let i = 0; i < n; i++) {
    addSample(`${name}_норма_${i + 1}`, 'ok', generateImage(shape, false));
    addSample(`${name}_дефект_${i + 1}`, 'defect', generateImage(shape, true));
  }
  invalidateTraining('набір даних змінено');
  log(`Згенеровано ${n * 2} зображень (${name}): ${n} без дефекту, ${n} з дефектом`);
  renderDataset();
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
  state.samples = []; state.selectedId = null; state.trained = false;
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
$('btn-train').addEventListener('click', async () => {
  const params = validateParams(true);
  if (!params) return;
  setBusy(true);
  setProgress(0, 'Навчання…');
  log(`Старт навчання: ${state.samples.length} зображень, еталон «${state.reference.name}», параметри ${JSON.stringify(params)}`);
  await Lab2.train(state.samples, state.reference, params, (p) => setProgress(p, `Навчання… ${p}%`));
  setProgress(100, 'Навчання завершено');
  state.trained = true;
  log('Навчання завершено (Лаб. 1: імітація, алгоритм буде в Лаб. 2)');
  setBusy(false);
  $('btn-train').focus();   // кнопка на час навчання блокується, тож повертаємо фокус, щоб він не «загубився»
});

$('btn-classify').addEventListener('click', async () => {
  const t = state.tests.find((x) => x.id === state.testSel);
  if (!t) return;
  const params = validateParams(true);
  if (!params) return;
  const res = await Lab2.classify(t, state.reference, params);   // зображення в області перегляду не перемальовується
  if (!res) {
    t.result = { kind: '', text: 'Алгоритм розпізнавання буде підключено в Лаб. 2' };
    log(`Розпізнавання «${t.name}»: алгоритм ще не підключено`);
  } else {
    const name = res.label === 'ok' ? 'Без дефекту' : 'Є дефект', pct = (res.confidence * 100).toFixed(0);
    t.result = { kind: res.label, text: `${name} (впевненість ${pct}%)`, short: `${name} · ${pct}%` };
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
  state.trained = true;
  setProgress(100, 'Навчання завершено');
  updateButtons();
}
