// Korean lunar conversion, including intercalary months. Supported solar years: 1000–2050.
// Converter: korean-lunar-calendar 0.4.0 (MIT), see vendor/korean-lunar-calendar.LICENSE.txt.
import KoreanLunarCalendar from './vendor/korean-lunar-calendar.mjs';
const calendar=new KoreanLunarCalendar(),cache=new Map();
export function getKoreanLunarDate(date){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 if(cache.has(date))return cache.get(date);
 const [year,month,day]=date.split('-').map(Number);
 if(!calendar.setSolarDate(year,month,day))return null;
 const lunar=Object.freeze({...calendar.getLunarCalendar()});
 if(cache.size>=512)cache.delete(cache.keys().next().value);
 cache.set(date,lunar);return lunar;
}
export function formatKoreanLunarDate(date,locale='ko',compact=false){
 const lunar=getKoreanLunarDate(date);if(!lunar)return '';
 if(locale==='en')return `${compact?'L':'Lunar '}${lunar.intercalation?'leap ':''}${lunar.month}.${lunar.day}`;
 return `${compact?'음 ':'음력 '}${lunar.intercalation?'윤 ':''}${lunar.month}.${lunar.day}`;
}
