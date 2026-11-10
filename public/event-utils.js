import KoreanLunarCalendar from './vendor/korean-lunar-calendar.mjs';

export const EVENT_COLORS = ['sage','blue','peach','lavender','coral','rose','yellow','teal','orange','cyan','indigo','slate'];

// Treat input as a local wall-clock value, independent of the server timezone.
function parseLocalDateTime(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new RangeError('날짜와 시간을 확인해 주세요.');
 const date=new Date(`${value}:00.000Z`);
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,16)!==value)throw new RangeError('날짜와 시간을 확인해 주세요.');
 return date;
}
export function isValidLocalDateTime(value) {
 try{parseLocalDateTime(value);return true;}catch{return false;}
}
export function shiftLocalDateTime(value,days=0,minutes=0) {
 const date=parseLocalDateTime(value);
 date.setUTCDate(date.getUTCDate()+days);
 date.setUTCMinutes(date.getUTCMinutes()+minutes);
 const shifted=date.toISOString().slice(0,16);
 if(!isValidLocalDateTime(shifted))throw new RangeError('날짜 범위를 확인해 주세요.');
 return shifted;
}
export function weeklyEventRanges(start,end,weeks=1) {
 if(!Number.isInteger(weeks)||weeks<1||weeks>52)throw new RangeError('반복 기간은 1~52주로 선택해 주세요.');
 if(!isValidLocalDateTime(start)||!isValidLocalDateTime(end)||end<=start)throw new RangeError('시작·종료 시간을 확인해 주세요.');
 return Array.from({length:weeks},(_,i)=>({start:shiftLocalDateTime(start,i*7),end:shiftLocalDateTime(end,i*7)}));
}

export function repeatEventRanges(start, end, { frequency = 'weekly', calendarType = 'solar', count = 1 } = {}) {
 if(!isValidLocalDateTime(start)||!isValidLocalDateTime(end)||end<=start)throw new RangeError('시작·종료 시간을 확인해 주세요.');
 if(!Number.isInteger(count))throw new RangeError('반복 횟수를 확인해 주세요.');
 if(frequency==='weekly'){
  if(count<1||count>52)throw new RangeError('반복 기간은 1~52주로 선택해 주세요.');
  return weeklyEventRanges(start,end,count);
 }
 if(frequency==='monthly'){
  if(count<1||count>36)throw new RangeError('반복 기간은 1~36개월로 선택해 주세요.');
 }else if(frequency==='yearly'){
  if(count<1||count>10)throw new RangeError('반복 기간은 1~10년으로 선택해 주세요.');
 }else{
  throw new RangeError('반복 주기를 확인해 주세요.');
 }

 const [startDateStr, startTimeStr] = start.split('T');
 const startEpoch = parseLocalDateTime(start).getTime();
 const endEpoch = parseLocalDateTime(end).getTime();
 const durationMinutes = Math.round((endEpoch - startEpoch) / 60000);

 const ranges = [];
 const cal = new KoreanLunarCalendar();

 for (let i = 0; i < count; i++) {
  if (i === 0) {
   ranges.push({ start, end });
   continue;
  }
  let targetDateStr;
  if (frequency === 'monthly') {
   if (calendarType === 'lunar') {
    const [baseY, baseM, baseD] = startDateStr.split('-').map(Number);
    cal.setSolarDate(baseY, baseM, baseD);
    const lunar = cal.getLunarCalendar();
    let curY = lunar.year, curM = lunar.month, isLeap = lunar.intercalation;
    const targetDay = lunar.day;
    for (let step = 0; step < i; step++) {
     const leapM = cal.getLunarIntercalationMonth(cal.getLunarData(curY));
     if (!isLeap && leapM === curM) isLeap = true;
     else { isLeap = false; curM++; if (curM > 12) { curM = 1; curY++; } }
    }
    const maxD = cal.getLunarMonthDays(curY, curM, isLeap);
    cal.setLunarDate(curY, curM, Math.min(targetDay, maxD), isLeap);
    const sol = cal.getSolarCalendar();
    targetDateStr = sol.year + '-' + String(sol.month).padStart(2, '0') + '-' + String(sol.day).padStart(2, '0');
   } else {
    const [baseY, baseM, baseD] = startDateStr.split('-').map(Number);
    const totalM = (baseM - 1) + i;
    const targetY = baseY + Math.floor(totalM / 12);
    const targetM = (totalM % 12) + 1;
    const maxD = new Date(Date.UTC(targetY, targetM, 0)).getUTCDate();
    targetDateStr = targetY + '-' + String(targetM).padStart(2, '0') + '-' + String(Math.min(baseD, maxD)).padStart(2, '0');
   }
  } else if (frequency === 'yearly') {
   if (calendarType === 'lunar') {
    const [baseY, baseM, baseD] = startDateStr.split('-').map(Number);
    cal.setSolarDate(baseY, baseM, baseD);
    const lunar = cal.getLunarCalendar();
    const targetY = lunar.year + i;
    const targetM = lunar.month;
    let targetLeap = lunar.intercalation;
    const leapM = cal.getLunarIntercalationMonth(cal.getLunarData(targetY));
    if (targetLeap && leapM !== targetM) targetLeap = false;
    const maxD = cal.getLunarMonthDays(targetY, targetM, targetLeap);
    if (!cal.setLunarDate(targetY, targetM, Math.min(lunar.day, maxD), targetLeap)) {
     cal.setLunarDate(targetY, targetM, Math.min(lunar.day, maxD), false);
    }
    const sol = cal.getSolarCalendar();
    targetDateStr = sol.year + '-' + String(sol.month).padStart(2, '0') + '-' + String(sol.day).padStart(2, '0');
   } else {
    const [baseY, baseM, baseD] = startDateStr.split('-').map(Number);
    const targetY = baseY + i;
    const maxD = new Date(Date.UTC(targetY, baseM, 0)).getUTCDate();
    targetDateStr = targetY + '-' + String(baseM).padStart(2, '0') + '-' + String(Math.min(baseD, maxD)).padStart(2, '0');
   }
  }
  const newStart = targetDateStr + 'T' + startTimeStr;
  const newEnd = shiftLocalDateTime(newStart, 0, durationMinutes);
  ranges.push({ start: newStart, end: newEnd });
 }
 return ranges;
}

export function calculateDdayDiff(targetDateStr, todayDateStr) {
 if (typeof targetDateStr !== 'string' || typeof todayDateStr !== 'string') return NaN;
 const tPart = targetDateStr.slice(0, 10);
 const bPart = todayDateStr.slice(0, 10);
 if (!/^\d{4}-\d{2}-\d{2}$/.test(tPart) || !/^\d{4}-\d{2}-\d{2}$/.test(bPart)) return NaN;
 const [tY, tM, tD] = tPart.split('-').map(Number);
 const [bY, bM, bD] = bPart.split('-').map(Number);
 const tUtc = Date.UTC(tY, tM - 1, tD);
 const bUtc = Date.UTC(bY, bM - 1, bD);
 return Math.round((tUtc - bUtc) / 86400000);
}

export function formatDdayLabel(targetDateStr, todayDateStr) {
 const diff = calculateDdayDiff(targetDateStr, todayDateStr);
 if (!Number.isFinite(diff)) return '';
 if (diff === 0) return 'D-Day';
 if (diff > 0) return `D-${diff}`;
 return `D+${Math.abs(diff)}`;
}

export function sortDdayEvents(ddayEvents = [], orderedIds = []) {
 const orderMap = new Map();
 if (Array.isArray(orderedIds)) {
  orderedIds.forEach((id, idx) => {
   if (typeof id === 'string' && !orderMap.has(id)) orderMap.set(id, idx);
  });
 }
 return ddayEvents.filter(e => e && e.is_dday).sort((a, b) => {
  const idxA = orderMap.has(a.id) ? orderMap.get(a.id) : Number.MAX_SAFE_INTEGER;
  const idxB = orderMap.has(b.id) ? orderMap.get(b.id) : Number.MAX_SAFE_INTEGER;
  if (idxA !== idxB) return idxA - idxB;
  return String(a.start || '').localeCompare(String(b.start || '')) || String(a.id || '').localeCompare(String(b.id || ''));
 });
}

export function moveDdayOrder(ddayEvents = [], orderedIds = [], eventId, stepOrTargetId) {
 const sorted = sortDdayEvents(ddayEvents, orderedIds).map(e => e.id);
 const fromIdx = sorted.indexOf(eventId);
 if (fromIdx === -1) return sorted;
 if (typeof stepOrTargetId === 'number') {
  const toIdx = fromIdx + stepOrTargetId;
  if (toIdx < 0 || toIdx >= sorted.length) return sorted;
  const temp = sorted[fromIdx];
  sorted[fromIdx] = sorted[toIdx];
  sorted[toIdx] = temp;
  return sorted;
 }
 if (typeof stepOrTargetId === 'string') {
  const toIdx = sorted.indexOf(stepOrTargetId);
  if (toIdx === -1 || toIdx === fromIdx) return sorted;
  sorted.splice(fromIdx, 1);
  sorted.splice(toIdx, 0, eventId);
  return sorted;
 }
 return sorted;
}

export function resolveAdjustedEndDateTime(start, end, allDay = false) {
 if (allDay) {
  if (typeof start === 'string' && start && (!end || end < start)) return start;
  return end || '';
 }
 if (!isValidLocalDateTime(start)) return end || '';
 if (isValidLocalDateTime(end) && start < end) {
  return end;
 }
 try {
  return shiftLocalDateTime(start, 0, 60);
 } catch {
  return end || '';
 }
}
