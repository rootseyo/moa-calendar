import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getKoreanLunarDate,formatKoreanLunarDate} from '../public/lunar.js';
test('Korean lunar dates match Seollal, Chuseok and an intercalary month',()=>{
 assert.deepEqual(getKoreanLunarDate('2026-02-17'),{year:2026,month:1,day:1,intercalation:false});
 assert.deepEqual(getKoreanLunarDate('2026-09-25'),{year:2026,month:8,day:15,intercalation:false});
 assert.deepEqual(getKoreanLunarDate('2025-07-25'),{year:2025,month:6,day:1,intercalation:true});
 assert.equal(formatKoreanLunarDate('2025-07-25'),'음력 윤 6.1');
 assert.equal(formatKoreanLunarDate('2026-09-25','en',true),'L8.15');
});
test('unsupported and invalid dates never reuse a previous lunar conversion',()=>{
 getKoreanLunarDate('2026-02-17');
 for(const date of ['2051-01-01','0999-01-01','2026-02-30','not-a-date',null])assert.equal(getKoreanLunarDate(date),null);
 assert.equal(formatKoreanLunarDate('2051-01-01'),'');
 assert.equal(getKoreanLunarDate('2026-02-17').day,1);
});

test('profile and preference lunar switches share persisted state and update the calendar',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const code=app.slice(app.indexOf('function lunarDatesEnabled('),app.indexOf('function renderMonthView('));
 const controls={'#lunar-display-toggle':{},'#profile-lunar-display-toggle':{},'#lunar-display-description':{},'#profile-lunar-display-description':{}};
 const storage=new Map();let renders=0;
 const context=vm.createContext({$:s=>controls[s],getActiveRegion:()=> 'KR',localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},renderCalendar:()=>renders++,translateMessage:s=>s});
 vm.runInContext(code,context);context.initializeLunarSettings();
 assert.equal(controls['#profile-lunar-display-toggle'].checked,true);
 controls['#profile-lunar-display-toggle'].checked=false;controls['#profile-lunar-display-toggle'].onchange();
 assert.equal(storage.get('moa_lunar_dates'),'false');assert.equal(controls['#lunar-display-toggle'].checked,false);assert.equal(context.lunarDatesEnabled(),false);
 controls['#lunar-display-toggle'].checked=true;controls['#lunar-display-toggle'].onchange();
 assert.equal(storage.get('moa_lunar_dates'),'true');assert.equal(controls['#profile-lunar-display-toggle'].checked,true);assert.equal(renders,2);
});
