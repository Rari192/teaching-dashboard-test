/*
 * sw.js — the offline helper (a "service worker").
 *
 * The first time the app is opened from its web address, this keeps a copy of every
 * app file on the iPad. After that the app opens from that copy, with or without a
 * connection. Your classes and timetable are not stored here — they live in the
 * iPad's database (see js/storage.js) — so updating the app never touches them.
 *
 * To publish an update: change APP_VERSION. The iPad downloads the new files in the
 * background and uses them the next time the app is opened, never mid-lesson.
 */
'use strict';

var APP_VERSION = '1.2.0';
var CACHE = 'teaching-dashboard-' + APP_VERSION;

var APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/schedule.js',
  './js/storage.js',
  './js/steps.js',
  './js/ui.js',
  './js/home.js',
  './js/timetable.js',
  './js/classes.js',
  './js/backup.js',
  './js/lessons.js',
  './js/lesson.js',
  './js/app.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// Save a copy of every app file. If any file fails to download, the install fails
// and the previous working copy stays in use.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(APP_FILES.map(function (url) { return new Request(url, { cache: 'reload' }); }));
    })
  );
});

// Once the new copy is complete, remove copies from older versions.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf('teaching-dashboard-') === 0 && key !== CACHE) return caches.delete(key);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Serve app files from the saved copy first; only go to the network for anything else.
self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Opening the app (or any page in it) always gets the saved index.html.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { cacheName: CACHE }).then(function (cached) {
        return cached || fetch(request);
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then(function (cached) {
      return cached || fetch(request);
    })
  );
});

// Lets the page ask which version is installed.
self.addEventListener('message', function (event) {
  if (event.data === 'version' && event.ports && event.ports[0]) event.ports[0].postMessage(APP_VERSION);
});
