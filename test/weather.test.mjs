import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WEATHER_PRESET_LOCATIONS,
  DEFAULT_WEATHER_LOCATION,
  getWeatherInfo,
  shouldShowRainProbability,
  parseOpenMeteoDaily,
  parseOpenMeteoHourly,
  renderWeatherBadgeHtml,
  renderHourlyWeatherItemsHtml,
  getSavedWeatherLocation,
  saveWeatherLocation,
  isWeatherEnabled,
  setWeatherEnabled
} from '../public/weather.js';
import { servePublicPage } from '../public-pages.mjs';

test('WMO weather codes map to emojis, show rain probability, and attach hourly forecast items', () => {
  const clear = getWeatherInfo(0);
  assert.equal(clear.emoji, '☀️');
  assert.equal(clear.isRain, false);
  assert.equal(shouldShowRainProbability(0, 10), false);
  assert.equal(shouldShowRainProbability(0, 40), true);

  const rain = getWeatherInfo(61);
  assert.equal(rain.emoji, '🌧️');
  assert.equal(rain.isRain, true);
  assert.equal(shouldShowRainProbability(61, 15), true);
  assert.equal(shouldShowRainProbability(61, 0), false);

  const hourlyRaw = {
    time: ['2026-10-29T09:00', '2026-10-29T10:00'],
    weather_code: [2, 63],
    precipitation_probability: [15, 80],
    temperature_2m: [13.6, 14.2]
  };
  const hourlyMap = parseOpenMeteoHourly(hourlyRaw);
  assert.equal(hourlyMap['2026-10-29'].length, 2);
  assert.equal(hourlyMap['2026-10-29'][1].emoji, '🌧️');
  assert.equal(hourlyMap['2026-10-29'][1].rainProbability, 80);
  assert.equal(hourlyMap['2026-10-29'][1].temperature, 14);

  const daily = parseOpenMeteoDaily({
    time: ['2026-10-28', '2026-10-29'],
    weather_code: [0, 63],
    precipitation_probability_max: [10, 75],
    temperature_2m_max: [18.4, 15.2],
    temperature_2m_min: [9.1, 10.8]
  }, hourlyRaw);

  const sunnyBadge = renderWeatherBadgeHtml(daily['2026-10-28'], 'month');
  assert.match(sunnyBadge, /<button[^>]*data-weather-date="2026-10-28"/);
  assert.match(sunnyBadge, /☀️/);
  assert.doesNotMatch(sunnyBadge, /weather-rain-prob/);

  const rainyBadge = renderWeatherBadgeHtml(daily['2026-10-29'], 'month');
  assert.match(rainyBadge, /<button[^>]*data-weather-date="2026-10-29"/);
  assert.match(rainyBadge, /🌧️/);
  assert.match(rainyBadge, /<span class="weather-rain-prob">75%<\/span>/);
  assert.match(rainyBadge, /강수확률 75%/);

  const hourlyHtml = renderHourlyWeatherItemsHtml(daily['2026-10-29'], 'ko', '2026-10-29T09:00');
  assert.match(hourlyHtml, /09:00/);
  assert.match(hourlyHtml, /지금/);
  assert.match(hourlyHtml, /10:00/);
  assert.match(hourlyHtml, /💧 80%/);
  assert.match(hourlyHtml, /14°/);
});

test('weather location and display toggle persist in storage', () => {
  const store = new Map();
  const mockStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v)
  };

  assert.equal(isWeatherEnabled(mockStorage), true);
  assert.equal(getSavedWeatherLocation(mockStorage).id, DEFAULT_WEATHER_LOCATION.id);

  const busan = WEATHER_PRESET_LOCATIONS.find(l => l.id === 'busan');
  saveWeatherLocation(busan, mockStorage);
  assert.equal(getSavedWeatherLocation(mockStorage).id, 'busan');
  assert.equal(getSavedWeatherLocation(mockStorage).name, '부산');

  setWeatherEnabled(false, mockStorage);
  assert.equal(isWeatherEnabled(mockStorage), false);
});

test('settings page, hourly dialog, and calendar views include weather badge and location controls', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="weather-settings-card"/);
  assert.match(html, /id="weather-display-toggle"/);
  assert.match(html, /id="weather-location-select"/);
  assert.match(html, /id="weather-location-query"/);
  assert.match(html, /id="weather-geolocate-btn"/);
  assert.match(html, /<dialog id="weather-hourly-dialog" closedby="any"/);

  const res = {
    headers: {},
    statusCode: 200,
    setHeader(k, v) { this.headers[k] = v; },
    end(body) { this.body = body; }
  };
  assert.equal(servePublicPage({ method: 'GET' }, res, '/weather.js', 'https://calendar.example'), true);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/javascript/);

  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /renderWeatherBadge\(key,'month'\)/);
  assert.match(app, /renderWeatherBadge\(key,'week'\)/);
  assert.match(app, /renderWeatherBadge\(selected,'day'\)/);
  assert.match(app, /renderWeatherBadge\(selected,'agenda'\)/);
  assert.match(app, /function openWeatherHourlyDialog\(/);
});
