'use strict';

/* Web Worker пулу: обчислює ознаку (кумулятивну гістограму різниці з еталоном) ОДНОГО зображення.
 * Кожне зображення незалежне від інших – тому цю фазу (на відміну від самого навчання) можна
 * розпаралелити між кількома воркерами без жодної зміни результату.
 * Декодування зображення тут відбувається через OffscreenCanvas/createImageBitmap, бо звичайний
 * document/<canvas> у Worker недоступний. */
importScripts('algorithm.js');   // дає self.LabCore: toGray, differenceImage, cumulativeHistogram, SIZE

let refCache = null, refUrl = null;   // еталон той самий для всіх завдань цього воркера – декодуємо раз

async function decodeGray(url) {
  const resp = await fetch(url);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const S = self.LabCore.SIZE;
  const canvas = new OffscreenCanvas(S, S);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
  ctx.drawImage(bitmap, 0, 0, S, S);
  bitmap.close();
  return self.LabCore.toGray(ctx.getImageData(0, 0, S, S).data);
}

self.onmessage = async (e) => {
  const { id, url, referenceUrl, bins } = e.data;
  try {
    if (refUrl !== referenceUrl) { refCache = await decodeGray(referenceUrl); refUrl = referenceUrl; }
    const gray = await decodeGray(url);
    const diff = self.LabCore.differenceImage(refCache, gray);
    const histogram = Array.from(self.LabCore.cumulativeHistogram(diff, bins));
    self.postMessage({ id, histogram });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
