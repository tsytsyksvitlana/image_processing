'use strict';

/* Web Worker: навчання мережі поза головним потоком, щоб інтерфейс не «зависав».
 * Отримує { data, params } – уже підготовлені навчальні пари; повертає JSON мережі. */
importScripts('lib/brain.min.js', 'algorithm.js');

self.onmessage = (e) => {
  try {
    const { data, params } = e.data;
    const result = self.LabCore.trainNetwork(data, params, (value, error) => {
      self.postMessage({ type: 'progress', value, error });
    });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
