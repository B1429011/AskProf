import fs from 'node:fs/promises';
const out=new URL('../app/data/cgu_public.json',import.meta.url);
const endpoint='https://www4.is.cgu.edu.tw/extphone/general/phone.aspx';
const clean=s=>(s||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();
const source=JSON.parse(await fs.readFile(out,'utf8'));
const formPage=await (await fetch(endpoint,{headers:{'User-Agent':'LearningNavigation/0.2 public-data-import'}})).text();
const hidden=[...formPage.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)].map(m=>m[0]);
const base={}; for(const input of hidden){const n=(input.match(/\bname="([^"]+)"/i)||[])[1],v=(input.match(/\bvalue="([^"]*)"/i)||[])[1]||'';if(n)base[n]=v;}
const lookup=async name=>{try{const body=new URLSearchParams({...base,txtcondition:name,btnsel:'查詢'});const h=await (await fetch(endpoint,{method:'POST',headers:{'User-Agent':'LearningNavigation/0.2 public-data-import','Content-Type':'application/x-www-form-urlencoded'},body})).text();for(const tr of h.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>clean(m[1]));if(cells.length<4)continue;const person=cells[2]||'';if(person.includes(name.replace(/\s/g,''))||name.replace(/\s/g,'').includes(person.replace(/\s/g,'')))return cells[3]||'';} }catch{}return ''};
const targets=source.faculty.filter(x=>!x.phone);
let next=0;const workers=Array.from({length:6},async()=>{while(true){const i=next++;if(i>=targets.length)break;const x=targets[i],phone=await lookup(x.name.replace(/\s*(\/|教授|副教授|助理教授|講師|臨床教授|臨床副教授|臨床助理教授).*$/,'').trim());if(phone)x.phone=`分機 ${phone}`;console.log(`${i+1}/${targets.length} ${x.name} ${phone||'未查到'}`);}});await Promise.all(workers);
source.phoneDirectoryCheckedAt=new Date().toISOString().slice(0,10);await fs.writeFile(out,JSON.stringify(source,null,2),'utf8');console.log('remainingWithoutPhone',source.faculty.filter(x=>!x.phone).length);
