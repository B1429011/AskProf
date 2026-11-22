import fs from 'node:fs/promises';
const out=new URL('../app/data/cgu_public.json',import.meta.url);
const data=JSON.parse(await fs.readFile(out,'utf8'));
const find=(name,department)=>data.faculty.find(x=>x.name.replace(/\s/g,'').includes(name)&&(!department||x.department===department));
const rows=[
  {name:'梁宏志',subjects:['微積分'],phone:'分機 5164',email:'D000018456@cgu.edu.tw',location:'管理大樓 8 樓｜自然科專業科目輔導員辦公室'},
  {name:'許恬綺',subjects:['普通生物學'],phone:'分機 5479',email:'D000019287@cgu.edu.tw',location:'第一醫學大樓 10 樓｜生物教學場域'},
  {name:'楊善位',subjects:['普通生物學'],phone:'分機 5479',email:'D000020546@cgu.edu.tw',location:'第一醫學大樓 10 樓｜生物教學場域'},
  {name:'陳國治',subjects:['工程數學'],phone:'分機 5164',email:'D000018820@cgu.edu.tw',location:'管理大樓 8 樓｜自然科專業科目輔導員辦公室'},
  {name:'羅名真',subjects:['程式設計'],phone:'分機 5842',email:'mclo@cgu.edu.tw',location:'管理大樓 5 樓｜資管系專業科目輔導員辦公室'},
  {name:'何秉浩',subjects:['化學'],phone:'分機 5475',email:'D000019877@cgu.edu.tw',location:'第一醫學大樓 3 樓｜有機化學實驗室'},
  {name:'胡明志',subjects:['物理'],phone:'分機 5164',email:'mjhu@cgu.edu.tw',location:'管理大樓 8 樓｜自然科專業科目輔導員辦公室'},
];
data.specialTutors=rows.map((r,i)=>{const f=find(r.name);return {id:`tutor-${i+1}`,name:r.name,role:'預約專業科目輔導員',subjects:r.subjects,department:'專業科目輔導員',email:r.email,phone:r.phone,location:r.location,specialty:f?.specialty||'',profileUrl:f?.profileUrl||'',availabilityKey:`t:${i+1}`,source:'長庚大學「預約專業科目輔導員」公告（2024/06/21）'};});
data.specialTutorsCount=data.specialTutors.length;
await fs.writeFile(out,JSON.stringify(data,null,2),'utf8');
console.log(`specialTutors=${data.specialTutors.length}`);
