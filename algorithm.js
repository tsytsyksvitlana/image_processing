'use strict';

/* ------------------------------------------------------------------
 * Лаб. 2: алгоритм розпізнавання дефектів.
 *
 * Зображення → різниця з еталоном → кумулятивна гістограма різниці → одношарова
 * нейромережа Brain.js (вихідні нейрони: «ok», «defect»).
 *
 * Файл працює у трьох середовищах: на сторінці (Lab2 з canvas), у Web Worker
 * (лише trainNetwork) і в Node (test.js: перевірка чистих функцій).
 * ------------------------------------------------------------------ */
(function (root) {
  const SIZE = 256;          // усі зображення зводяться до SIZE×SIZE: ознака має бути порівнянною
  const VAL_SHARE = 0.2;     // частка валідаційної вибірки
  const MIN_PER_CLASS = 5;   // менше – валідаційної вибірки не робимо (лишалось би 1 зображення)

  /* ---------- 1. Чисті функції: ознаки ---------- */

  // RGBA → яскравість 0..255 (ITU-R BT.601). Прозорість тут вже відсутня: canvas залито білим.
  function toGray(rgba) {
    const g = new Uint8ClampedArray(rgba.length / 4);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    return g;
  }

  // |еталон − зображення| попіксельно
  function differenceImage(ref, img) {
    const d = new Uint8ClampedArray(ref.length);
    for (let i = 0; i < d.length; i++) d[i] = Math.abs(ref[i] - img[i]);
    return d;
  }

  // Кумулятивна гістограма різницевого зображення: h[i] – частка пікселів, чия різниця ненульова
  // і не перевищує верхню межу інтервалу i (рівні 0..255 поділені на `bins` рівних інтервалів).
  // Нульова різниця не враховується: для зображення без дефекту всі значення дорівнюють 0
  // (саме так у статті), а для дефектного крива зростає до частки змінених пікселів.
  function cumulativeHistogram(diff, bins) {
    const h = new Float64Array(bins);
    for (let i = 0; i < diff.length; i++) {
      const v = diff[i];
      if (v > 0) h[Math.min(bins - 1, Math.floor(v * bins / 256))]++;
    }
    let acc = 0;
    for (let i = 0; i < bins; i++) { acc += h[i]; h[i] = acc / diff.length; }
    return h;
  }

  // Дефект займає ~1% пікселів, тож сирі значення (≈0.005) сигмоїда майже не відрізняє від нуля.
  // Ділимо на найбільше значення навчальної вибірки й обмежуємо одиницею: вхід мережі ∈ [0; 1].
  function scaleFeatures(h, scale) {
    return Array.from(h, (v) => Math.min(1, v / scale));
  }

  /* ---------- 2. Навчальні пари та поділ вибірки ---------- */

  function mulberry32(seed) {   // детермінований ГВЧ: один і той самий набір дає той самий поділ
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Стратифікований поділ: кожен клас ділиться окремо, щоб валідація містила обидва класи
  function splitDataset(items, seed = 42) {
    const rnd = mulberry32(seed), train = [], val = [];
    for (const label of ['ok', 'defect']) {
      const cls = items.filter((x) => x.label === label);
      for (let i = cls.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cls[i], cls[j]] = [cls[j], cls[i]]; }
      const nVal = cls.length >= MIN_PER_CLASS ? Math.max(1, Math.round(cls.length * VAL_SHARE)) : 0;
      val.push(...cls.slice(0, nVal));
      train.push(...cls.slice(nVal));
    }
    return { train, val };
  }

  // Метрики за формулою зі статті; «позитивний» клас – дефект
  function confusion(pred, truth) {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (let i = 0; i < pred.length; i++) {
      if (truth[i] === 'defect') pred[i] === 'defect' ? tp++ : fn++;
      else pred[i] === 'defect' ? fp++ : tn++;
    }
    const n = tp + fp + tn + fn;
    return { tp, fp, tn, fn, n, accuracy: n ? (tp + tn) / n : NaN };
  }

  // Вихід мережі → клас і впевненість. Сигмоїдні виходи не дають у сумі 1, тому нормуємо їх.
  function decide(out) {
    const sum = out.ok + out.defect || 1;
    const label = out.defect > out.ok ? 'defect' : 'ok';
    return { label, confidence: out[label] / sum };
  }

  /* ---------- 3. Навчання (виконується у Web Worker або, як запасний варіант, у сторінці) ---------- */

  // data: [{ input: number[], output: {ok|defect: 1} }]. hidden = 0 – одношарова мережа (як у статті).
  function trainNetwork(data, params, onProgress) {
    const net = new root.brain.NeuralNetwork({ hiddenLayers: params.hidden > 0 ? [params.hidden] : [] });
    const stats = net.train(data, {
      iterations: params.epochs,
      learningRate: params.lr,
      errorThresh: 0.005,
      callbackPeriod: Math.max(1, Math.floor(params.epochs / 100)),
      callback: (s) => onProgress(s.iterations / params.epochs, s.error),
    });
    return { json: net.toJSON(), error: stats.error, iterations: stats.iterations };
  }

  const core = { SIZE, toGray, differenceImage, cumulativeHistogram, scaleFeatures, splitDataset, confusion, decide, trainNetwork };

  /* ---------- 4. Частина для сторінки: canvas, Worker, стан моделі ---------- */

  if (typeof document !== 'undefined') {
    const grayCache = new Map();   // url → Uint8ClampedArray; один файл декодується один раз

    function loadGray(url) {
      if (grayCache.has(url)) return Promise.resolve(grayCache.get(url));
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = SIZE;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SIZE, SIZE);   // прозорість → білий фон
          ctx.drawImage(img, 0, 0, SIZE, SIZE);
          const g = toGray(ctx.getImageData(0, 0, SIZE, SIZE).data);
          grayCache.set(url, g);
          resolve(g);
        };
        img.onerror = () => reject(new Error('Не вдалося прочитати зображення'));
        img.src = url;
      });
    }

    function diffToImageData(diff) {
      const out = new ImageData(SIZE, SIZE);
      for (let i = 0, p = 0; i < diff.length; i++, p += 4) { out.data[p] = out.data[p + 1] = out.data[p + 2] = diff[i]; out.data[p + 3] = 255; }
      return out;
    }

    // Запускає навчання у Worker; якщо Worker недоступний (наприклад, відкрито через file://) – у сторінці.
    function runTraining(data, params, onProgress) {
      return new Promise((resolve, reject) => {
        let worker;
        try { worker = new Worker('worker.js'); } catch (e) { worker = null; }
        const inline = () => {
          try { resolve({ ...trainNetwork(data, params, onProgress), inWorker: false }); } catch (e) { reject(e); }
        };
        if (!worker) { setTimeout(inline, 0); return; }
        worker.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'progress') onProgress(m.value, m.error);
          else if (m.type === 'done') { worker.terminate(); resolve({ ...m.result, inWorker: true }); }
          else if (m.type === 'error') { worker.terminate(); reject(new Error(m.message)); }
        };
        worker.onerror = () => { worker.terminate(); setTimeout(inline, 0); };   // скрипт Worker не завантажився
        worker.postMessage({ data, params });
      });
    }

    // Обчислює ознаки (різниця+гістограма) для всіх samples. На відміну від самого навчання (яке
    // послідовне по епохах), кожне зображення тут повністю незалежне від інших – тому це
    // "embarrassingly parallel" задача: розподіляємо її між кількома Worker'ами (feature-worker.js).
    // Якщо Worker/OffscreenCanvas недоступні – падаємо назад на послідовний прохід у сторінці.
    function extractFeaturesParallel(samples, referenceUrl, bins, onProgress) {
      const poolSize = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8, samples.length));
      let workers;
      try { workers = Array.from({ length: poolSize }, () => new Worker('feature-worker.js')); }
      catch (e) { workers = null; }

      const sequential = async () => {
        const items = [];
        for (const s of samples) {
          const f = await Lab2.inspect(s.url, referenceUrl, bins);
          items.push({ label: s.label, hist: f.histogram });
          onProgress(Math.round(100 * items.length / samples.length));
        }
        return { items, inPool: false, workers: 1 };
      };

      if (!workers) return sequential();

      return new Promise((resolve) => {
        const results = new Array(samples.length);
        let nextIdx = 0, done = 0, failed = false;
        const finish = (fallbackPromise) => {
          workers.forEach((w) => { try { w.terminate(); } catch (e) {} });
          if (fallbackPromise) fallbackPromise.then(resolve);
          else resolve({ items: results, inPool: true, workers: poolSize });
        };
        const assign = (w) => {
          if (failed) return;
          if (nextIdx >= samples.length) { w.terminate(); return; }
          const idx = nextIdx++;
          w.postMessage({ id: idx, url: samples[idx].url, referenceUrl, bins });
        };
        workers.forEach((w) => {
          w.onmessage = (e) => {
            if (failed) return;
            const { id, histogram, error } = e.data;
            if (error) { failed = true; finish(sequential()); return; }
            results[id] = { label: samples[id].label, hist: Float64Array.from(histogram) };
            done++;
            onProgress(Math.round(100 * done / samples.length));
            if (done === samples.length) finish(null);
            else assign(w);
          };
          // немає OffscreenCanvas/createImageBitmap у цьому браузері чи скрипт не завантажився
          w.onerror = () => { if (!failed) { failed = true; finish(sequential()); } };
          assign(w);
        });
      });
    }

    const Lab2 = {
      model: null,   // { net, bins, scale, params, metrics }

      // Ознаки одного зображення без мережі: різниця з еталоном та її кумулятивна гістограма
      async inspect(url, referenceUrl, bins) {
        const [ref, img] = await Promise.all([loadGray(referenceUrl), loadGray(url)]);
        const diff = differenceImage(ref, img);
        return { diff: diffToImageData(diff), histogram: cumulativeHistogram(diff, bins) };
      },

      // Навчання: samples – [{ url, label }]. Повертає метрики; onProgress(0..100).
      async train(samples, reference, params, onProgress) {
        this.model = null;
        onProgress(0);
        const t0f = performance.now();
        const { items, inPool, workers: poolSize } = await extractFeaturesParallel(
          samples, reference.url, params.bins, (p) => onProgress(Math.round(10 * p / 100)));
        this.lastExtract = { seconds: (performance.now() - t0f) / 1000, inPool, workers: poolSize };
        const { train, val } = splitDataset(items);
        // Не Math.max(1e-9, ...усі_значення): при великих вибірках (сотні зображень × bins) розкладання
        // масиву в окремі аргументи функції перевищує ліміт стека виклику рушія – тому цикл, а не spread.
        let scale = 1e-9;
        for (const x of train) for (const v of x.hist) if (v > scale) scale = v;
        const data = train.map((x) => ({ input: scaleFeatures(x.hist, scale), output: { [x.label]: 1 } }));

        const t0 = performance.now();
        const res = await runTraining(data, params, (v) => onProgress(10 + Math.round(90 * v)));   // 10–100%: навчання
        const net = new root.brain.NeuralNetwork().fromJSON(res.json);

        const evaluate = (set) => confusion(
          set.map((x) => decide(net.run(scaleFeatures(x.hist, scale))).label), set.map((x) => x.label));
        this.model = { net, bins: params.bins, scale, params };
        return {
          train: evaluate(train), val: val.length ? evaluate(val) : null,
          error: res.error, iterations: res.iterations, inWorker: res.inWorker,
          seconds: (performance.now() - t0) / 1000,
          extract: this.lastExtract,
        };
      },

      // Розпізнавання: image – { url }. Повертає { label, confidence, histogram, diff } або null, якщо мережі ще немає.
      async classify(image, reference) {
        const m = this.model;
        if (!m) return null;
        const f = await this.inspect(image.url, reference.url, m.bins);
        const { label, confidence } = decide(m.net.run(scaleFeatures(f.histogram, m.scale)));
        return { label, confidence, histogram: f.histogram, diff: f.diff };
      },

      reset() { this.model = null; },
    };
    root.Lab2 = Lab2;
  }

  root.LabCore = core;
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})(typeof globalThis !== 'undefined' ? globalThis : self);
