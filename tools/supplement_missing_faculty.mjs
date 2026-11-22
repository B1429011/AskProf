import fs from 'node:fs/promises';
const root='https://www.cgu.edu.tw/'; const out=new URL('../app/data/cgu_public.json',import.meta.url);
const clean=(s='')=>s.replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/\s+/g,' ').trim();
const abs=(h,b)=>new URL(h.replace(/&amp;/g,'&'),b).href;
async function get(u){const r=await fetch(u,{headers:{'User-Agent':'LearningNavigation/0.2 public-data-import'}});if(!r.ok)throw new Error(`${r.status} ${u}`);return r.text()}
function links(h){return [...h.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m=>({a:m[1],body:m[2],href:(m[1].match(/\bhref\s*=\s*["']([^"']+)/i)||[])[1]||'',title:(m[1].match(/\btitle\s*=\s*["']([^"']*)/i)||[])[1]||''}))}
function field(s,labels){return clean((s.match(new RegExp(`(?:${labels})\\s*[:：]?\\s*([^<\\n]+)`,'i'))||[])[1]||'')}
function facultyFromPage(html,department,location,base){const rows=[];for(const x of links(html)){if(!x.href||!/(?:Subject\/Detail|FullTimeProfessorManagement\/Detail|\/med\/Contents\?nodeId=|cgmh\.org\.tw\/tw\/Services\/DoctorInfo)/i.test(x.href))continue;if(!/(教授|副教授|助理教授|講師|老師)/.test(x.title))continue;if(/賀|恭喜|徵聘|優良教師|影片|辦法|課程/.test(x.title))continue;const name=clean(x.title),profileUrl=abs(x.href,base);rows.push({name,department,location,email:(x.body.match(/(?:mailto:|信箱\s*[:：]?\s*)([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i)||[])[1]||'',phone:field(x.body,'電話|分機'),degree:field(x.body,'學歷'),specialty:field(x.body,'專長領域|專長|研究方向|研究領域')||clean(x.body).slice(0,180),profileUrl})}return rows}
function namedDetailRows(html,department,base,path){const rows=[];for(const x of links(html)){if(!x.href||!x.title||!x.href.includes(path))continue;if(/首頁|活動|公告|恭賀|重要/.test(x.title))continue;const name=clean(x.title);if(name.length>40)continue;rows.push({name,department,location:'',email:(x.body.match(/(?:mailto:|信箱\s*[:：]?\s*)([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i)||[])[1]||'',phone:'',degree:'',specialty:'',profileUrl:abs(x.href,base)})}return rows}
function imageAltRows(html,department,base){const rows=[];for(const m of html.matchAll(/<a[^>]+href="([^"]*Subject\/Detail[^"]*)"[^>]*>[\s\S]*?<img[^>]+alt="([^"]+)"/gi)){const name=clean(m[2]).replace(/教授|副教授|助理教授$/,'');if(!name||name.length>20)continue;rows.push({name,department,location:'',email:'',phone:'',degree:'',specialty:'',profileUrl:abs(m[1],base)})}return rows}
function cardRows(html,department,base){const rows=[];for(const block of html.split(/<div class="card card_list pic">/i).slice(1)){const title=clean((block.match(/<(?:p|h[1-6])[^>]*class="[^"]*card-title[^>]*>([\s\S]*?)<\/(?:p|h[1-6])>/i)||[])[1]||'');const href=(block.match(/href="([^"]*(?:FullTimeProfessorManagement|Subject\/Detail)[^"]*)"/i)||[])[1]||'';if(!title||!href)continue;rows.push({name:title,department,location:'',email:(block.match(/(?:mailto:|信箱\s*[:：]?\s*)([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i)||[])[1]||'',phone:field(block,'電話|分機'),degree:field(block,'學歷'),specialty:field(block,'專長領域|專長|研究方向|研究領域')||'',profileUrl:abs(href,base)})}return rows}
function opticalRows(html,department,base){const rows=[];const re=/<strong><span[^>]*>([^<]+)<\/span><\/strong>[\s\S]{0,900}?Email:\s*([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/gi;for(const m of html.matchAll(re))rows.push({name:clean(m[1]),department,location:'',email:m[2],phone:'',degree:'',specialty:'',profileUrl:base});return rows}
function imageRoster(html,department,base){const rows=[];for(const m of html.matchAll(/<img[^>]+alt="([^"<>]+)"/gi)){const name=clean(m[1]);if(!name||name.length>20||/logo|教師|老師|照片|系徽/i.test(name))continue;rows.push({name,department,location:'',email:'',phone:'',degree:'',specialty:'',profileUrl:base})}return rows}
function subjectTitleRows(html,department,base){const rows=[];const seen=new Set();for(const x of links(html)){if(!x.href||!x.title||seen.has(x.title)||/首頁|主任|老師\.{0,2}$|活動|公告|恭賀|重要/.test(x.title))continue;if(!/(?:Subject\/Detail|FullTimeProfessorManagement\/Detail)/i.test(x.href))continue;const name=clean(x.title);if(name.length<2||name.length>20||!/^[\u3400-\u9fff\s·]+$/.test(name))continue;seen.add(name);rows.push({name,department,location:'',email:'',phone:'',degree:'',specialty:'',profileUrl:abs(x.href,base)})}return rows}
async function hsmRows(html,department,base){const rows=[];const seen=new Set();for(const x of links(html)){if(!x.href||!/(?:www\.cgu\.edu\.tw\/hsm\/Subject\/Detail|\/hsm\/Subject\/Detail)/i.test(x.href))continue;const profileUrl=abs(x.href,base);if(seen.has(profileUrl))continue;seen.add(profileUrl);try{const detail=await get(profileUrl);const title=(detail.match(/<meta[^>]+name="DC\.Title"[^>]+content="([^"]+)"/i)||[])[1]||'';let name=clean(title.split('-').pop()||'').replace(/(主任|教授|副教授|助理教授|講師|老師)\s*$/,'').trim();if(!name||name.length>20)continue;rows.push({name,department,location:'',email:(detail.match(/(?:mailto:|信箱\s*[:：]?\s*)([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i)||[])[1]||'',phone:field(detail,'電話|分機'),degree:field(detail,'學歷'),specialty:field(detail,'專長領域|專長|研究方向|研究領域'),profileUrl})}catch{}}return rows}
function needRows(html,department,location,base){const rows=[];const re=/<a\s+href="([^"]+)"[^>]*>\s*<b>([^<]+)<\/b><\/a>[\s\S]{0,1400}?mailto:([^"<>]+)/gi;for(const m of html.matchAll(re)){const name=clean(m[2]);if(!name)continue;rows.push({name,department,location,email:m[3],phone:'',degree:'',specialty:'',profileUrl:abs(m[1],base)})}return rows}
async function enrich(rows){for(const x of rows){if(x.email||!/^https:\/\/www\.cgu\.edu\.tw\//.test(x.profileUrl))continue;try{const h=await get(x.profileUrl);x.email=(h.match(/(?:mailto:|信箱\s*[:：]?\s*)([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i)||[])[1]||'';x.phone=x.phone||field(h,'電話|分機');x.specialty=x.specialty||field(h,'專長領域|專長|研究方向|研究領域')}catch{}}return rows}
const data=JSON.parse(await fs.readFile(out,'utf8'));
const medicalScienceTargets=[
  ['解剖學科','https://www.cgu.edu.tw/anatomy/','https://www.cgu.edu.tw/anatomy/FullTimeProfessorManagement?nodeId=3054'],
  ['病理學科','https://www.cgu.edu.tw/pathology/','https://www.cgu.edu.tw/pathology/FullTimeProfessorManagement?nodeId=17511'],
  ['生理暨藥理學科','https://www.cgu.edu.tw/dop/','https://www.cgu.edu.tw/dop/FullTimeProfessorManagement?nodeId=3004'],
  ['微生物及免疫學科','https://www.cgu.edu.tw/dmi/','https://www.cgu.edu.tw/dmi/FullTimeProfessorManagement?nodeId=18063'],
  ['公衛暨寄生蟲學科','https://www.cgu.edu.tw/parasitology/','https://www.cgu.edu.tw/parasitology/Contents?nodeId=8734'],
  ['人文及社會醫學科','https://www.cgu.edu.tw/hsm/','https://www.cgu.edu.tw/hsm/Contents?nodeId=14569'],
  ['生化暨分子生物學科','https://www.cgu.edu.tw/b-cb/','https://www.cgu.edu.tw/b-cb/FullTimeProfessorManagement?nodeId=3329'],
];
for(const [name,url,facultyUrl] of medicalScienceTargets)if(!data.departments.some(d=>d.name===name))data.departments.push({name,url,location:'',facultyUrl});
const targets=[
  ...medicalScienceTargets.map(([name,,facultyUrl])=>[name,[facultyUrl]]),
  ['醫學系',['https://www.cgu.edu.tw/med/Contents?nodeId=3169']],
  ['生物醫學系(含臨床試驗與評估碩士班)',['https://www.cgu.edu.tw/ls/Contents?nodeId=3228','https://www.cgu.edu.tw/ls/Contents?nodeId=15842']],
  ['電機工程學系',['https://www.cgu.edu.tw/ee/ContentSection?nodeId=17869','https://www.cgu.edu.tw/ee/ContentSection?nodeId=17875','https://www.cgu.edu.tw/ee/ContentSection?nodeId=17876']],
  ['資訊管理學系',['https://www.cgu.edu.tw/im/Subject?nodeId=12445','https://www.cgu.edu.tw/im/Subject?nodeId=12445&page=2']],
  ['奈米工程及設計碩士學位學程',['https://www.cgu.edu.tw/need/Contents?nodeId=7462']],
  ['智慧醫療創新碩士學位學程',['https://www.cgu.edu.tw/ism/Subject?nodeId=4039','https://www.cgu.edu.tw/ism/Subject?nodeId=4040']],
  ['醫學影像暨放射科學系',['https://www.cgu.edu.tw/mirs/Contents?nodeId=8871']],
  ['顯微手術國際碩士學位學程',['https://www.cgu.edu.tw/rm/Contents?nodeId=10313']],
  ['機械工程學系',['https://www.cgu.edu.tw/me/Contents?nodeId=11101']],
  ['工業設計學系',['https://www.cgu.edu.tw/id/Subject?nodeId=3992']],
  ['醫務管理學系',['https://www.cgu.edu.tw/hcm/Subject?nodeId=4518']],
  ['醫學生物技術暨檢驗學系',['https://www.cgu.edu.tw/mip/FullTimeProfessorManagement?nodeId=11932']],
  ['生物醫學工程學系',['https://www.cgu.edu.tw/bme/FullTimeProfessorManagement?nodeId=16002']],
  ['工商管理學系',['https://www.cgu.edu.tw/ibm/FullTimeProfessorManagement?nodeId=3970']],
  ['光電工程研究所',['https://www.cgu.edu.tw/gioeoe/Subject/Detail/30461?nodeId=10128']],
  ['顯微手術國際碩士學位學程',['https://www.cgu.edu.tw/rm/Contents?nodeId=10313']],
];
for(const [department,urls] of targets){
  let rows=[];
  for(const url of urls){try{const h=await get(url);let part;if(department.includes('奈米'))part=needRows(h,department,'',url);else if(department==='醫學影像暨放射科學系')part=namedDetailRows(h,department,url,'/mirs/Subject/Detail');else if(department==='顯微手術國際碩士學位學程')part=imageRoster(h,department,url);else if(department==='機械工程學系')part=imageAltRows(h,department,url);else if(department==='光電工程研究所')part=opticalRows(h,department,url);else if(department==='公衛暨寄生蟲學科')part=subjectTitleRows(h,department,url);else if(department==='人文及社會醫學科')part=await hsmRows(h,department,url);else {part=facultyFromPage(h,department,'',url);if(!part.length)part=cardRows(h,department,url)}rows.push(...part)}catch(e){console.log('skip',url,e.message)}}
  rows=await enrich(rows);
  const existing=data.faculty.filter(x=>x.department!==department);
  data.faculty=[...new Map([...existing,...rows].map(x=>[`${x.department}|${x.name}|${x.profileUrl}`,x])).values()];
  const d=data.departments.find(x=>x.name===department); if(d)d.facultyUrl=urls[0];
  console.log(department,rows.length);
}
// The official academic-unit directory omits university-wide teaching centers.
// Read CGU's public extension directory and add its teaching staff as searchable records.
const extensionDirectory='https://www4.is.cgu.edu.tw/extphone/general/phone.aspx';
try{
  const page=await get(extensionDirectory);
  const hidden=[...page.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)].map(m=>m[0]);
  const values={};
  for(const input of hidden){const name=(input.match(/\bname="([^"]+)"/i)||[])[1],value=(input.match(/\bvalue="([^"]*)"/i)||[])[1]||'';if(name)values[name]=value;}
  const body=new URLSearchParams({...values,txtcondition:'通識中心',btnsel:'查詢'});
  const response=await fetch(extensionDirectory,{method:'POST',headers:{'User-Agent':'LearningNavigation/0.2 public-data-import','Content-Type':'application/x-www-form-urlencoded'},body});
  if(!response.ok)throw new Error(`${response.status} ${extensionDirectory}`);
  const html=await response.text();
  const decode=s=>clean(s).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'");
  const rows=[];
  for(const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const text=[...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>decode(m[1]));
    if(text.length<4)continue;
    const [unit,title,name,extension,...other]=text;
    if(!/教授|副教授|助理教授|講師|專輔教師/.test(title)||!name)continue;
    const department=unit.replace(/^通識中心/,'通識中心');
    if(!data.departments.some(d=>d.name===department))data.departments.push({name:department,url:extensionDirectory,location:'',facultyUrl:extensionDirectory});
    rows.push({name:`${name} / ${title}`,department,location:'',email:'',phone:extension?`分機 ${extension}`:'',degree:'',specialty:other.filter(Boolean).join('、'),profileUrl:extensionDirectory});
  }
  const imported=rows.map(x=>({...x,verifiedBy:'CGU public extension directory'}));
  const others=data.faculty.filter(x=>!/^通識中心/.test(x.department));
  data.faculty=[...new Map([...others,...imported].map(x=>[`${x.department}|${x.name}`,x])).values()];
  console.log(`通識中心公開教學師資 ${imported.length}`);
}catch(e){console.log('通識中心公開分機目錄匯入失敗',e.message);}
data.failures=(data.failures||[]).filter(f=>!targets.some(t=>t[0]===f.department));
data.fetchedAt=new Date().toISOString().slice(0,10);
await fs.writeFile(out,JSON.stringify(data,null,2),'utf8');
console.log('total',data.faculty.length);
