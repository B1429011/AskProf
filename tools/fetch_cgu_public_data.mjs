import fs from 'node:fs/promises';

const root = 'https://www.cgu.edu.tw/';
const directory = 'https://www.cgu.edu.tw/ch/Contents?nodeId=269';
const out = new URL('../app/data/cgu_public.json', import.meta.url);
const clean = (s='') => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/g, "'").replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
const abs = (href, base) => new URL(href.replace(/&amp;/g, '&'), base).href;
async function get(url) { const r = await fetch(url, {headers:{'User-Agent':'LearningNavigation/0.2 public-data-import'}}); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }
function links(html) { return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({attrs:m[1], body:m[2], href:(m[1].match(/\bhref\s*=\s*["']([^"']+)/i)||[])[1]||'', title:(m[1].match(/\btitle\s*=\s*["']([^"']*)/i)||[])[1]||''})); }
function facultyUrl(home, html) {
  const candidates = links(html).filter(x => x.href && !/^javascript:/i.test(x.href) && !/\/Detail\//i.test(x.href) && (/FullTimeProfessorManagement/i.test(x.href) || /專任師資|師資資訊|專任教師|教學師資/.test(x.title))).map(x => abs(x.href, home));
  return candidates.find(x=>/FullTimeProfessorManagement/i.test(x)) || candidates[0] || '';
}
function field(block, labels) { const re = new RegExp(`(?:${labels})\\s*[:：]?\\s*([^<\\n]+)`, 'i'); return clean((block.match(re)||[])[1]||''); }
function parseFacultyPage(html, department, location, base) {
  const rows=[]; const seen=new Set();
  const blocks=[...html.matchAll(/<div\s+class=["']card\s+card_list\s+pic["'][^>]*>([\s\S]*?)(?=<div\s+class=["']card\s+card_list\s+pic["']|<div\s+class=["']pn["'])/gi)].map(x=>x[1]);
  for (const block of blocks) {
    const a=block.match(/<a\b([^>]*)>/i); const href=(a?.[1]?.match(/\bhref\s*=\s*["']([^"']+)/i)||[])[1]||'';
    const title=(block.match(/<(?:p|h[1-6])[^>]*class=["'][^"']*card-title[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|h[1-6])>/i)||[])[1]||'';
    const name=clean(title); if (!name || !href) continue; const profileUrl=abs(href,base); const key=`${name}|${profileUrl}`; if(seen.has(key)) continue; seen.add(key);
    const email=(block.match(/(?:mailto:|信箱\s*[:：]?\s*)([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)||[])[1]||'';
    rows.push({name,department,location,email,phone:field(block,'電話|分機'),degree:field(block,'學歷'),specialty:field(block,'專長領域|專長|研究方向|研究領域')||clean(block).slice(0,180),profileUrl});
  }
  if (rows.length) return rows;
  for (const x of links(html)) {
    if (!x.href || !/(?:FullTimeProfessorManagement\/Detail|Subject\/Detail|Contents\?nodeId=)/i.test(x.href)) continue;
    if (!/(教授|副教授|助理教授|講師)/.test(x.title)) continue;
    if (/辦法|課程|教師升等/.test(x.title)) continue;
    const name=clean(x.title); const profileUrl=abs(x.href, base); const key=`${name}|${profileUrl}`; if (seen.has(key)) continue; seen.add(key);
    const email=(x.body.match(/(?:mailto:|信箱\s*[:：]?\s*)([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)||[])[1]||'';
    rows.push({name,department,location,email,phone:field(x.body,'電話|分機'),degree:field(x.body,'學歷'),specialty:field(x.body,'專長領域|專長|研究方向|研究領域')||clean(x.body).slice(0,180),profileUrl});
  }
  return rows;
}
async function allFacultyPages(url) {
  const pages=[]; const visited=new Set(); let current=url;
  for (let i=0; current && !visited.has(current) && i<30; i++) { visited.add(current); let html; try { html=await get(current); } catch { break; } pages.push({html,url:current}); const next=[...html.matchAll(/href=["']([^"']*SwitchPage[^"']*page=\d+[^"']*)["']/gi)].map(x=>abs(x[1],current)); current=next[0]||''; }
  return pages;
}
const data=JSON.parse(await fs.readFile(out,'utf8')); const faculty=[]; const failures=[];
for (let i=0;i<data.departments.length;i++) {
  const d=data.departments[i]; try {
    const home=await get(d.url); const loc=field(home,'(?:學系|系所)位置')||d.location||''; d.location=loc; d.facultyUrl=facultyUrl(d.url,home);
    // The first FullTimeProfessorManagement link on IBM's site is a single-person page.
    // Use the official full roster page instead.
    if(d.name==='工商管理學系')d.facultyUrl='https://www.cgu.edu.tw/ibm/FullTimeProfessorManagement?nodeId=3970';
    if (!d.facultyUrl) { failures.push({department:d.name,reason:'官方系所頁未找到專任教師入口'}); continue; }
    for (const page of await allFacultyPages(d.facultyUrl)) faculty.push(...parseFacultyPage(page.html,d.name,loc,page.url));
  } catch (e) { failures.push({department:d.name,reason:String(e.message||e)}); }
  console.log(`[${i+1}/${data.departments.length}] ${d.name}`);
}
const dedup=[...new Map(faculty.map(x=>[`${x.department}|${x.name}|${x.profileUrl}`,x])).values()];
data.source='長庚大學官方網站'; data.directoryUrl=directory; data.fetchedAt=new Date().toISOString().slice(0,10); data.faculty=dedup; data.failures=failures;
await fs.writeFile(out,JSON.stringify(data,null,2),'utf8'); console.log(`departments=${data.departments.length} faculty=${dedup.length} failures=${failures.length}`);
