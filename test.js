'use strict';
// Перевірка чистих функцій алгоритму: node test.js
const assert = require('assert');
const brain = require('./lib/brain.min.js');
globalThis.brain = brain;
const C = require('./algorithm.js');

// 1. toGray: біле → 255, чорне → 0, чисте червоне → 76
assert.deepStrictEqual([...C.toGray(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]))], [255, 0, 76]);

// 2. різниця
assert.deepStrictEqual([...C.differenceImage(Uint8Array.of(0, 255, 100), Uint8Array.of(10, 255, 40))], [10, 0, 60]);

// 3. кумулятивна гістограма: без різниці – суцільні нулі; інакше монотонна і закінчується часткою змінених пікселів
const zero = C.cumulativeHistogram(new Uint8Array(100), 16);
assert.ok(zero.every((v) => v === 0), 'clean image → all zeros');
const d = new Uint8Array(100); d[0] = 255; d[1] = 255; d[2] = 10;
const h = C.cumulativeHistogram(d, 16);
assert.strictEqual(h[15], 0.03);
assert.ok(h.every((v, i) => i === 0 || v >= h[i - 1]), 'monotonic');
assert.strictEqual(h[0], 0.01);   // 10 → інтервал 0 (0..15)

// 4. поділ вибірки: стратифікований, детермінований, без витоку між частинами
const items = [...Array(10)].map((_, i) => ({ label: 'ok', i })).concat([...Array(10)].map((_, i) => ({ label: 'defect', i })));
const a = C.splitDataset(items), b = C.splitDataset(items);
assert.deepStrictEqual(a, b);
assert.strictEqual(a.val.length, 4);
assert.strictEqual(a.val.filter((x) => x.label === 'ok').length, 2);
assert.ok(a.val.every((v) => !a.train.includes(v)));
assert.strictEqual(C.splitDataset(items.slice(0, 3).concat(items.slice(10, 13))).val.length, 0, 'мало даних → без валідації');

// 5. метрики
const m = C.confusion(['defect', 'defect', 'ok', 'ok'], ['defect', 'ok', 'ok', 'defect']);
assert.deepStrictEqual([m.tp, m.fp, m.tn, m.fn, m.accuracy], [1, 1, 1, 1, 0.5]);

// 6. наскрізно на синтетичних гістограмах: мережа має відрізнити нуль від «сходинки»
const bins = 32, mk = (defect) => Float64Array.from({ length: bins }, (_, i) => (defect && i > 8 ? 0.004 * (1 + Math.random()) : 0));
const set = [];
for (let i = 0; i < 20; i++) set.push({ label: i % 2 ? 'defect' : 'ok', hist: mk(i % 2) });
const scale = Math.max(...set.flatMap((x) => [...x.hist]));
const data = set.map((x) => ({ input: C.scaleFeatures(x.hist, scale), output: { [x.label]: 1 } }));
for (const hidden of [0, 8]) {
  const r = C.trainNetwork(data, { hidden, epochs: 300, lr: 0.1 }, () => {});
  const net = new brain.NeuralNetwork().fromJSON(r.json);
  assert.strictEqual(net.sizes.length, hidden ? 3 : 2, 'hidden=0 → одношарова мережа');
  assert.strictEqual(C.decide(net.run(C.scaleFeatures(mk(0), scale))).label, 'ok');
  assert.strictEqual(C.decide(net.run(C.scaleFeatures(mk(1), scale))).label, 'defect');
}
console.log('усі перевірки пройдено');
