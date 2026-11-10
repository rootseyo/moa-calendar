import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateSource, english } from '../public/translations.js';

test('iCloud integration UI elements and markup are present in index.html', () => {
  const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  // Dialogs
  assert.match(indexHtml, /id="calendar-integrations-dialog"/);
  assert.match(indexHtml, /id="icloud-disconnect-dialog"/);

  // Tabs
  assert.match(indexHtml, /data-provider-tab="icloud"/);
  assert.match(indexHtml, /data-provider-tab="google"/);

  // Form & inputs
  assert.match(indexHtml, /id="icloud-connect-form"/);
  assert.match(indexHtml, /id="icloud-email-input"/);
  assert.match(indexHtml, /id="icloud-password-input"/);
  assert.match(indexHtml, /id="btn-connect-icloud"/);

  // Connected view
  assert.match(indexHtml, /id="icloud-connected-view"/);
  assert.match(indexHtml, /id="icloud-connected-email"/);
  assert.match(indexHtml, /id="btn-sync-icloud-now"/);
  assert.match(indexHtml, /id="btn-open-disconnect-icloud"/);
  assert.match(indexHtml, /id="icloud-calendars-list"/);

  // Disconnect actions
  assert.match(indexHtml, /id="btn-disconnect-keep"/);
  assert.match(indexHtml, /id="btn-disconnect-delete"/);

  // Mobile more menu integration trigger
  assert.match(indexHtml, /data-mobile-action="integrations"/);
});

test('iCloud integration CSS rules exist in style.css', () => {
  const styleCss = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

  assert.match(styleCss, /\.icloud-cal-pill/);
  assert.match(styleCss, /\.apple-badge-icon/);
  assert.match(styleCss, /\.integration-providers-tabs/);
  assert.match(styleCss, /\.integration-tab/);
  assert.match(styleCss, /\.integration-notice-box/);
  assert.match(styleCss, /\.integration-status-card/);
  assert.match(styleCss, /\.icloud-calendars-list/);
  assert.match(styleCss, /\.icloud-cal-item/);
  assert.match(styleCss, /\.sync-direction-select/);
});

test('app.js handles iCloud integration workflows and API calls', () => {
  const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  // Integrations dialog functions
  assert.match(appJs, /function openCalendarIntegrationsDialog/);
  assert.match(appJs, /async function loadCalendarIntegrations/);
  assert.match(appJs, /function renderICloudView/);

  // API endpoints
  assert.match(appJs, /api\('\/api\/me\/calendar-connections\/icloud',\s*'POST'/);
  assert.match(appJs, /api\('\/api\/me\/calendar-connections'/);
  assert.match(appJs, /api\(`\/api\/me\/external-calendars\/\$\{extId\}`,\s*'PATCH'/);
  assert.match(appJs, /api\(`\/api\/me\/calendar-connections\/\$\{currentICloudConnection\.id\}\/sync`,\s*'POST'/);
  assert.match(appJs, /api\(`\/api\/me\/calendar-connections\/\$\{connId\}`,\s*'DELETE'/);

  // Pill badge & icons
  assert.match(appJs, /icloud-cal-pill/);
  assert.match(appJs, /data-open-integrations/);
  assert.match(appJs, /isICloud/);
});

test('iCloud translations and English source translations are accurate', () => {
  assert.equal(english['캘린더 연동'], 'Calendar Integrations');
  assert.equal(english['Apple 앱 암호(App-Specific Password)로 안전하게 연결'], 'Securely connect with an Apple App-Specific Password');
  assert.equal(english['Apple 계정 이메일'], 'Apple Account Email');
  assert.equal(english['Apple 앱 암호'], 'Apple App-Specific Password');
  assert.equal(english['iCloud 캘린더 연결'], 'Connect iCloud Calendar');
  assert.equal(english['iCloud 캘린더 목록'], 'iCloud Calendars');
  assert.equal(english['지금 동기화'], 'Sync Now');
  assert.equal(english['iCloud 캘린더 연결 해제'], 'Disconnect iCloud Calendar');
  assert.equal(english['가져온 일정 유지하고 연결만 해제'], 'Keep imported events and disconnect only');
  assert.equal(english['가져온 캘린더 및 일정 모두 삭제'], 'Delete all imported calendars and events');
  assert.equal(english['iCloud 캘린더 연동'], 'iCloud Calendar Integration');

  const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const enHtml = translateSource(indexHtml);
  assert.match(enHtml, /iCloud Calendar Integration/);
  assert.match(enHtml, /Securely connect with an Apple App-Specific Password/);
  assert.match(enHtml, /Disconnect iCloud Calendar/);
});
