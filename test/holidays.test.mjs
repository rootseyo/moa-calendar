import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHoliday, getRegionName, detectDefaultRegion, HOLIDAY_REGIONS, KOREA_HOLIDAYS, US_HOLIDAYS, JP_HOLIDAYS, GB_HOLIDAYS } from '../public/holidays.js';

test('Korea holidays resolve accurately in both Korean and English', () => {
  // Solar & Fixed holidays
  assert.equal(getHoliday('2026-01-01', 'KR', 'ko'), '신정');
  assert.equal(getHoliday('2026-01-01', 'KR', 'en'), "New Year's Day");
  assert.equal(getHoliday('2026-03-01', 'KR', 'ko'), '삼일절');
  assert.equal(getHoliday('2026-03-01', 'KR', 'en'), 'Independence Movement Day');
  assert.equal(getHoliday('2026-03-02', 'KR', 'ko'), '대체공휴일(삼일절)');
  assert.equal(getHoliday('2026-03-02', 'KR', 'en'), 'Substitute Holiday (Independence Movement Day)');

  // Lunar holidays (Seollal & Chuseok)
  assert.equal(getHoliday('2026-02-17', 'KR', 'ko'), '설날');
  assert.equal(getHoliday('2026-02-17', 'KR', 'en'), 'Lunar New Year');
  assert.equal(getHoliday('2026-09-25', 'KR', 'ko'), '추석');
  assert.equal(getHoliday('2026-09-25', 'KR', 'en'), 'Chuseok');

  // Christmas / Buddha's Birthday / Children's Day
  assert.equal(getHoliday('2026-05-05', 'KR', 'ko'), '어린이날');
  assert.equal(getHoliday('2026-05-05', 'KR', 'en'), "Children's Day");
  assert.equal(getHoliday('2026-12-25', 'KR', 'ko'), '기독탄신일');
  assert.equal(getHoliday('2026-12-25', 'KR', 'en'), 'Christmas Day');
});

test('US federal holidays resolve accurately in both English and Korean', () => {
  assert.equal(getHoliday('2026-01-01', 'US', 'en'), "New Year's Day");
  assert.equal(getHoliday('2026-01-01', 'US', 'ko'), '새해 첫날');
  assert.equal(getHoliday('2026-01-19', 'US', 'en'), 'Martin Luther King Jr. Day');
  assert.equal(getHoliday('2026-01-19', 'US', 'ko'), '마틴 루터 킹의 날');
  assert.equal(getHoliday('2026-07-04', 'US', 'en'), 'Independence Day');
  assert.equal(getHoliday('2026-07-04', 'US', 'ko'), '독립기념일');
  assert.equal(getHoliday('2026-11-26', 'US', 'en'), 'Thanksgiving Day');
  assert.equal(getHoliday('2026-11-26', 'US', 'ko'), '추수감사절');

  // KR specific holiday should not appear for US
  assert.equal(getHoliday('2026-03-01', 'US', 'en'), null);
});

test('Japan national holidays resolve accurately with substitute holidays', () => {
  assert.equal(getHoliday('2026-01-01', 'JP', 'ko'), '신정(원단)');
  assert.equal(getHoliday('2026-01-01', 'JP', 'en'), "New Year's Day");
  assert.equal(getHoliday('2026-05-03', 'JP', 'ko'), '헌법기념일');
  assert.equal(getHoliday('2026-05-04', 'JP', 'ko'), '녹색의 날');
  assert.equal(getHoliday('2026-05-05', 'JP', 'ko'), '어린이날');
  // May 6 is substitute holiday because May 3 was Sunday
  assert.equal(getHoliday('2026-05-06', 'JP', 'ko'), '대체휴일');
  assert.equal(getHoliday('2026-05-06', 'JP', 'en'), 'Substitute Holiday');
});

test('UK bank holidays resolve accurately', () => {
  assert.equal(getHoliday('2026-04-03', 'GB', 'en'), 'Good Friday');
  assert.equal(getHoliday('2026-04-03', 'GB', 'ko'), '성금요일');
  assert.equal(getHoliday('2026-04-06', 'GB', 'en'), 'Easter Monday');
  assert.equal(getHoliday('2026-04-06', 'GB', 'ko'), '부활절 월요일');
  assert.equal(getHoliday('2026-12-25', 'GB', 'en'), 'Christmas Day');
  assert.equal(getHoliday('2026-12-28', 'GB', 'en'), 'Boxing Day (Substitute day)');
});

test('Setting region to none disables all holidays', () => {
  assert.equal(getHoliday('2026-01-01', 'none', 'ko'), null);
  assert.equal(getHoliday('2026-03-01', 'none', 'ko'), null);
  assert.equal(getHoliday('2026-07-04', 'none', 'en'), null);
  assert.equal(getHoliday('2026-12-25', 'none', 'en'), null);
});

test('Region names and detector function reliably', () => {
  assert.equal(getRegionName('KR', 'ko'), '대한민국');
  assert.equal(getRegionName('KR', 'en'), 'South Korea');
  assert.equal(getRegionName('US', 'ko'), '미국');
  assert.equal(getRegionName('US', 'en'), 'United States');
  assert.equal(getRegionName('JP', 'ko'), '일본');
  assert.equal(getRegionName('JP', 'en'), 'Japan');
  assert.equal(getRegionName('GB', 'ko'), '영국');
  assert.equal(getRegionName('GB', 'en'), 'United Kingdom');
  assert.equal(getRegionName('none', 'ko'), '공휴일 표시 안 함');
  assert.equal(getRegionName('none', 'en'), 'No holidays');

  const detected = detectDefaultRegion();
  assert.ok(['KR', 'US', 'JP', 'GB'].includes(detected));
  assert.ok(HOLIDAY_REGIONS.length >= 6);
});
