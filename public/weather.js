// Weather forecast & location utilities (powered by Open-Meteo free API)

export const WEATHER_PRESET_LOCATIONS = [
  { id: 'seoul', name: '서울', nameEn: 'Seoul', admin1: '서울특별시', country: '대한민국', latitude: 37.5665, longitude: 126.9780, timezone: 'Asia/Seoul' },
  { id: 'busan', name: '부산', nameEn: 'Busan', admin1: '부산광역시', country: '대한민국', latitude: 35.1796, longitude: 129.0756, timezone: 'Asia/Seoul' },
  { id: 'incheon', name: '인천', nameEn: 'Incheon', admin1: '인천광역시', country: '대한민국', latitude: 37.4563, longitude: 126.7052, timezone: 'Asia/Seoul' },
  { id: 'daegu', name: '대구', nameEn: 'Daegu', admin1: '대구광역시', country: '대한민국', latitude: 35.8714, longitude: 128.6014, timezone: 'Asia/Seoul' },
  { id: 'daejeon', name: '대전', nameEn: 'Daejeon', admin1: '대전광역시', country: '대한민국', latitude: 36.3504, longitude: 127.3845, timezone: 'Asia/Seoul' },
  { id: 'gwangju', name: '광주', nameEn: 'Gwangju', admin1: '광주광역시', country: '대한민국', latitude: 35.1595, longitude: 126.8526, timezone: 'Asia/Seoul' },
  { id: 'ulsan', name: '울산', nameEn: 'Ulsan', admin1: '울산광역시', country: '대한민국', latitude: 35.5384, longitude: 129.3114, timezone: 'Asia/Seoul' },
  { id: 'sejong', name: '세종', nameEn: 'Sejong', admin1: '세종특별자치시', country: '대한민국', latitude: 36.4800, longitude: 127.2890, timezone: 'Asia/Seoul' },
  { id: 'suwon', name: '수원', nameEn: 'Suwon', admin1: '경기도', country: '대한민국', latitude: 37.2636, longitude: 127.0286, timezone: 'Asia/Seoul' },
  { id: 'seongnam', name: '성남', nameEn: 'Seongnam', admin1: '경기도', country: '대한민국', latitude: 37.4200, longitude: 127.1267, timezone: 'Asia/Seoul' },
  { id: 'goyang', name: '고양', nameEn: 'Goyang', admin1: '경기도', country: '대한민국', latitude: 37.6584, longitude: 126.8320, timezone: 'Asia/Seoul' },
  { id: 'yongin', name: '용인', nameEn: 'Yongin', admin1: '경기도', country: '대한민국', latitude: 37.2411, longitude: 127.1776, timezone: 'Asia/Seoul' },
  { id: 'chuncheon', name: '춘천', nameEn: 'Chuncheon', admin1: '강원특별자치도', country: '대한민국', latitude: 37.8813, longitude: 127.7298, timezone: 'Asia/Seoul' },
  { id: 'gangneung', name: '강릉', nameEn: 'Gangneung', admin1: '강원특별자치도', country: '대한민국', latitude: 37.7519, longitude: 128.8761, timezone: 'Asia/Seoul' },
  { id: 'cheongju', name: '청주', nameEn: 'Cheongju', admin1: '충청북도', country: '대한민국', latitude: 36.6424, longitude: 127.4890, timezone: 'Asia/Seoul' },
  { id: 'jeonju', name: '전주', nameEn: 'Jeonju', admin1: '전북특별자치도', country: '대한민국', latitude: 35.8242, longitude: 127.1480, timezone: 'Asia/Seoul' },
  { id: 'pohang', name: '포항', nameEn: 'Pohang', admin1: '경상북도', country: '대한민국', latitude: 36.0190, longitude: 129.3435, timezone: 'Asia/Seoul' },
  { id: 'changwon', name: '창원', nameEn: 'Changwon', admin1: '경상남도', country: '대한민국', latitude: 35.2281, longitude: 128.6811, timezone: 'Asia/Seoul' },
  { id: 'jeju', name: '제주', nameEn: 'Jeju', admin1: '제주특별자치도', country: '대한민국', latitude: 33.4996, longitude: 126.5312, timezone: 'Asia/Seoul' },
  { id: 'tokyo', name: '도쿄', nameEn: 'Tokyo', admin1: 'Tokyo', country: '일본', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' },
  { id: 'osaka', name: '오사카', nameEn: 'Osaka', admin1: 'Osaka', country: '일본', latitude: 34.6937, longitude: 135.5023, timezone: 'Asia/Tokyo' },
  { id: 'new_york', name: '뉴욕', nameEn: 'New York', admin1: 'New York', country: '미국', latitude: 40.7128, longitude: -74.0060, timezone: 'America/New_York' },
  { id: 'los_angeles', name: '로스앤젤레스', nameEn: 'Los Angeles', admin1: 'California', country: '미국', latitude: 34.0522, longitude: -118.2437, timezone: 'America/Los_Angeles' },
  { id: 'london', name: '런던', nameEn: 'London', admin1: 'England', country: '영국', latitude: 51.5074, longitude: -0.1278, timezone: 'Europe/London' },
  { id: 'paris', name: '파리', nameEn: 'Paris', admin1: 'Île-de-France', country: '프랑스', latitude: 48.8566, longitude: 2.3522, timezone: 'Europe/Paris' },
  { id: 'sydney', name: '시드니', nameEn: 'Sydney', admin1: 'New South Wales', country: '호주', latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney' }
];

export const DEFAULT_WEATHER_LOCATION = WEATHER_PRESET_LOCATIONS[0];

const escapeAttr = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function getWeatherInfo(code, locale = 'ko') {
  const num = Number(code);
  let info;
  if (num === 0) {
    info = { emoji: '☀️', label: '맑음', labelEn: 'Clear', isRain: false, isSnow: false };
  } else if (num === 1) {
    info = { emoji: '🌤️', label: '대체로 맑음', labelEn: 'Mainly clear', isRain: false, isSnow: false };
  } else if (num === 2) {
    info = { emoji: '⛅', label: '구름 조금', labelEn: 'Partly cloudy', isRain: false, isSnow: false };
  } else if (num === 3) {
    info = { emoji: '☁️', label: '흐림', labelEn: 'Overcast', isRain: false, isSnow: false };
  } else if (num === 45 || num === 48) {
    info = { emoji: '🌫️', label: '안개', labelEn: 'Fog', isRain: false, isSnow: false };
  } else if ([51, 53, 55, 56, 57].includes(num)) {
    info = { emoji: '🌦️', label: '이슬비', labelEn: 'Drizzle', isRain: true, isSnow: false };
  } else if ([61, 63, 65, 66, 67].includes(num)) {
    info = { emoji: '🌧️', label: '비', labelEn: 'Rain', isRain: true, isSnow: false };
  } else if ([71, 73, 75, 77, 85, 86].includes(num)) {
    info = { emoji: '❄️', label: '눈', labelEn: 'Snow', isRain: false, isSnow: true };
  } else if ([80, 81, 82].includes(num)) {
    info = { emoji: '🌧️', label: '소나기', labelEn: 'Rain showers', isRain: true, isSnow: false };
  } else if ([95, 96, 99].includes(num)) {
    info = { emoji: '⛈️', label: '뇌우', labelEn: 'Thunderstorm', isRain: true, isSnow: false };
  } else {
    info = { emoji: '🌤️', label: '맑음', labelEn: 'Clear', isRain: false, isSnow: false };
  }
  return {
    code: Number.isFinite(num) ? num : 0,
    ...info,
    text: locale === 'en' ? info.labelEn : info.label
  };
}

export function shouldShowRainProbability(code, rainProbability) {
  if (rainProbability === null || rainProbability === undefined || rainProbability === '') return false;
  const prob = Math.round(Number(rainProbability));
  if (!Number.isFinite(prob) || prob <= 0) return false;
  const info = getWeatherInfo(code);
  return Boolean(info.isRain || prob >= 30);
}

export function parseOpenMeteoHourly(hourly) {
  const byDate = {};
  if (!hourly || !Array.isArray(hourly.time)) return byDate;
  const times = hourly.time;
  const codes = Array.isArray(hourly.weather_code) ? hourly.weather_code : (Array.isArray(hourly.weathercode) ? hourly.weathercode : []);
  const probs = Array.isArray(hourly.precipitation_probability) ? hourly.precipitation_probability : [];
  const temps = Array.isArray(hourly.temperature_2m) ? hourly.temperature_2m : [];

  for (let i = 0; i < times.length; i++) {
    const timeStr = String(times[i] || '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(timeStr)) continue;
    const date = timeStr.slice(0, 10);
    const hourLabel = timeStr.slice(11, 16);
    const hour = parseInt(timeStr.slice(11, 13), 10);
    const rawCode = codes[i];
    if (rawCode === null || rawCode === undefined) continue;
    const info = getWeatherInfo(rawCode);
    const rawProb = probs[i];
    const rainProbability = rawProb !== null && rawProb !== undefined && Number.isFinite(Number(rawProb))
      ? Math.max(0, Math.min(100, Math.round(Number(rawProb))))
      : null;
    const temperature = temps[i] !== null && temps[i] !== undefined && Number.isFinite(Number(temps[i]))
      ? Math.round(Number(temps[i]))
      : null;

    if (!byDate[date]) byDate[date] = [];
    byDate[date].push({
      time: timeStr.slice(0, 16),
      date,
      hour,
      hourLabel,
      code: info.code,
      emoji: info.emoji,
      label: info.label,
      labelEn: info.labelEn,
      isRain: info.isRain,
      isSnow: info.isSnow,
      rainProbability,
      showRainProbability: shouldShowRainProbability(info.code, rainProbability),
      temperature
    });
  }
  return byDate;
}

export function parseOpenMeteoDaily(daily, hourly = null) {
  const result = {};
  if (!daily || !Array.isArray(daily.time)) return result;
  const hourlyByDate = hourly ? parseOpenMeteoHourly(hourly) : {};
  const times = daily.time;
  const codes = Array.isArray(daily.weather_code) ? daily.weather_code : (Array.isArray(daily.weathercode) ? daily.weathercode : []);
  const probs = Array.isArray(daily.precipitation_probability_max) ? daily.precipitation_probability_max : [];
  const maxTemps = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
  const minTemps = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];

  for (let i = 0; i < times.length; i++) {
    const date = times[i];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const rawCode = codes[i];
    if (rawCode === null || rawCode === undefined) continue;
    const info = getWeatherInfo(rawCode);
    const rawProb = probs[i];
    const rainProbability = rawProb !== null && rawProb !== undefined && Number.isFinite(Number(rawProb))
      ? Math.max(0, Math.min(100, Math.round(Number(rawProb))))
      : null;
    const tempMax = maxTemps[i] !== null && maxTemps[i] !== undefined && Number.isFinite(Number(maxTemps[i]))
      ? Math.round(Number(maxTemps[i]))
      : null;
    const tempMin = minTemps[i] !== null && minTemps[i] !== undefined && Number.isFinite(Number(minTemps[i]))
      ? Math.round(Number(minTemps[i]))
      : null;

    result[date] = {
      date,
      code: info.code,
      emoji: info.emoji,
      label: info.label,
      labelEn: info.labelEn,
      isRain: info.isRain,
      isSnow: info.isSnow,
      rainProbability,
      showRainProbability: shouldShowRainProbability(info.code, rainProbability),
      tempMax,
      tempMin,
      hourly: hourlyByDate[date] || []
    };
  }
  return result;
}

export function formatWeatherTooltip(entry, locale = 'ko') {
  if (!entry) return '';
  const parts = [locale === 'en' ? (entry.labelEn || entry.label) : entry.label];
  if (entry.rainProbability !== null && entry.rainProbability !== undefined && (entry.showRainProbability || entry.rainProbability > 0)) {
    parts.push(locale === 'en' ? `Precipitation ${entry.rainProbability}%` : `강수확률 ${entry.rainProbability}%`);
  }
  if (entry.tempMin !== null && entry.tempMax !== null) {
    parts.push(locale === 'en' ? `${entry.tempMin}°C / ${entry.tempMax}°C` : `최저 ${entry.tempMin}° / 최고 ${entry.tempMax}°`);
  }
  parts.push(locale === 'en' ? 'Click for hourly forecast' : '클릭하여 시간대별 날씨 보기');
  return parts.join(' · ');
}

export function renderWeatherBadgeHtml(entry, kind = 'month', locale = 'ko') {
  if (!entry || !entry.emoji) return '';
  const tooltip = formatWeatherTooltip(entry, locale);
  const showProb = Boolean(entry.showRainProbability && entry.rainProbability !== null && entry.rainProbability !== undefined);
  const probHtml = showProb ? `<span class="weather-rain-prob">${entry.rainProbability}%</span>` : '';
  return `<button type="button" class="weather-badge weather-badge-${escapeAttr(kind)}${showProb ? ' is-rainy' : ''}" data-weather-date="${escapeAttr(entry.date || '')}" title="${escapeAttr(tooltip)}" aria-label="${escapeAttr(tooltip)}"><span class="weather-emoji" aria-hidden="true">${entry.emoji}</span>${probHtml}</button>`;
}

export function renderHourlyWeatherItemsHtml(entry, locale = 'ko', currentHourKey = '') {
  const list = Array.isArray(entry?.hourly) ? entry.hourly : [];
  if (!list.length) {
    return `<p class="muted small weather-hourly-empty">${locale === 'en' ? 'Hourly forecast is not available for this date.' : '이 날짜의 시간대별 날씨 정보가 없습니다.'}</p>`;
  }
  return list.map(item => {
    const isNow = Boolean(currentHourKey && item.time === currentHourKey);
    const condText = locale === 'en' ? (item.labelEn || item.label) : item.label;
    const hasProb = item.rainProbability !== null && item.rainProbability !== undefined && (item.showRainProbability || item.rainProbability > 0);
    const probBadge = hasProb
      ? `<span class="weather-hourly-prob ${item.showRainProbability ? 'is-high' : ''}">💧 ${item.rainProbability}%</span>`
      : '<span class="weather-hourly-prob is-zero">-</span>';
    const tempText = item.temperature !== null && item.temperature !== undefined ? `${item.temperature}°` : '-';
    return `<div class="weather-hourly-row${isNow ? ' is-now' : ''}${item.showRainProbability ? ' is-rainy-hour' : ''}">
      <span class="weather-hourly-time">${escapeAttr(item.hourLabel)}${isNow ? `<small class="weather-now-pill">${locale === 'en' ? 'Now' : '지금'}</small>` : ''}</span>
      <span class="weather-hourly-condition"><span class="weather-hourly-emoji" aria-hidden="true">${item.emoji}</span><span>${escapeAttr(condText)}</span></span>
      ${probBadge}
      <strong class="weather-hourly-temp">${escapeAttr(tempText)}</strong>
    </div>`;
  }).join('');
}

export function normalizeWeatherLocation(raw) {
  if (!raw) return { ...DEFAULT_WEATHER_LOCATION };
  if (typeof raw === 'string') {
    const preset = WEATHER_PRESET_LOCATIONS.find(item => item.id === raw || item.name === raw || item.nameEn.toLowerCase() === raw.toLowerCase());
    if (preset) return { ...preset };
  }
  if (typeof raw === 'object') {
    if (raw.id) {
      const preset = WEATHER_PRESET_LOCATIONS.find(item => item.id === raw.id);
      if (preset && (raw.latitude === undefined || raw.longitude === undefined)) {
        return { ...preset };
      }
    }
    const lat = Number(raw.latitude);
    const lon = Number(raw.longitude);
    if (Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180) {
      const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : DEFAULT_WEATHER_LOCATION.name;
      const nameEn = typeof raw.nameEn === 'string' && raw.nameEn.trim() ? raw.nameEn.trim().slice(0, 80) : name;
      return {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 80) : `custom:${lat.toFixed(4)},${lon.toFixed(4)}`,
        name,
        nameEn,
        admin1: typeof raw.admin1 === 'string' ? raw.admin1.trim().slice(0, 80) : '',
        country: typeof raw.country === 'string' ? raw.country.trim().slice(0, 80) : '',
        latitude: Number(lat.toFixed(4)),
        longitude: Number(lon.toFixed(4)),
        timezone: typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone.trim() : 'Asia/Seoul'
      };
    }
  }
  return { ...DEFAULT_WEATHER_LOCATION };
}

export function getSavedWeatherLocation(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem('moa_weather_location');
    if (!raw) return { ...DEFAULT_WEATHER_LOCATION };
    try {
      return normalizeWeatherLocation(JSON.parse(raw));
    } catch {
      return normalizeWeatherLocation(raw);
    }
  } catch {
    return { ...DEFAULT_WEATHER_LOCATION };
  }
}

export function saveWeatherLocation(location, storage = globalThis.localStorage) {
  const normalized = normalizeWeatherLocation(location);
  try {
    storage?.setItem('moa_weather_location', JSON.stringify(normalized));
  } catch {}
  return normalized;
}

export function isWeatherEnabled(storage = globalThis.localStorage) {
  try {
    return storage?.getItem('moa_weather_enabled') !== 'false';
  } catch {
    return true;
  }
}

export function setWeatherEnabled(enabled, storage = globalThis.localStorage) {
  const flag = Boolean(enabled);
  try {
    storage?.setItem('moa_weather_enabled', String(flag));
  } catch {}
  return flag;
}

export function getWeatherLocationDisplayName(location, locale = 'ko') {
  const loc = normalizeWeatherLocation(location);
  const baseName = locale === 'en' ? (loc.nameEn || loc.name) : loc.name;
  if (loc.admin1 && loc.admin1 !== baseName && !loc.id.startsWith('seoul') && !WEATHER_PRESET_LOCATIONS.some(p => p.id === loc.id)) {
    return `${baseName} (${loc.admin1})`;
  }
  return baseName;
}

export function buildOpenMeteoForecastUrl(location) {
  const loc = normalizeWeatherLocation(location);
  const params = new URLSearchParams({
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    daily: 'weather_code,precipitation_probability_max,temperature_2m_max,temperature_2m_min',
    hourly: 'weather_code,temperature_2m,precipitation_probability',
    timezone: loc.timezone || 'auto',
    past_days: '7',
    forecast_days: '16'
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export function buildOpenMeteoGeocodingUrl(query, locale = 'ko') {
  const params = new URLSearchParams({
    name: String(query ?? '').trim(),
    count: '8',
    language: locale === 'en' ? 'en' : 'ko',
    format: 'json'
  });
  return `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
}
