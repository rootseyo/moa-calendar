import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateSource, english } from '../public/translations.js';

test('calendar deletion UI elements and translations are present and correct', () => {
 const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
 assert.match(indexHtml, /id="calendar-delete-section"/);
 assert.match(indexHtml, /id="delete-calendar-btn"/);
 assert.match(indexHtml, /캘린더 삭제/);

 const appJs = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
 assert.match(appJs, /api\(`\/api\/calendars\/\$\{id\}`,\s*'DELETE'/);
 assert.match(appJs, /google-cal-pill/);
 assert.match(appJs, /calendar-manage-btn/);
 assert.match(appJs, /delete-calendar-btn/);

 const styleCss = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
 assert.match(styleCss, /#delete-calendar-btn/);
 assert.match(styleCss, /\.calendar-delete-section/);
 assert.match(styleCss, /\.google-cal-pill/);
 assert.match(styleCss, /\.calendar-manage-btn/);

 // Translation checks
 assert.equal(english['캘린더 삭제'], 'Delete calendar');
 assert.equal(english['관리자만 캘린더를 삭제할 수 있습니다.'], 'Only the administrator can delete this calendar.');
 assert.equal(english['캘린더를 삭제했어요.'], 'Calendar deleted.');
 assert.equal(english['Google 캘린더 연동'], 'Google Calendar linked');

 const translatedEnHtml = translateSource(indexHtml);
 assert.match(translatedEnHtml, />Delete calendar<\/button>/);
});

test('terms and privacy policies accurately state calendar deletion', () => {
 const terms = readFileSync(new URL('../public/terms.html', import.meta.url), 'utf8');
 assert.match(terms, /캘린더 관리자는 캘린더 관리 화면에서 직접 캘린더를 삭제할 수 있으며/);

 const privacy = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');
 assert.match(privacy, /캘린더 관리자는 캘린더 관리 화면에서 직접 캘린더를 삭제할 수 있으며/);
});
