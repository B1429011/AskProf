import fs from 'node:fs/promises';
const out=new URL('../app/data/cgu_public.json',import.meta.url);
const data=JSON.parse(await fs.readFile(out,'utf8'));
const find=(name,department)=>data.faculty.find(x=>x.name.replace(/\s/g,'').includes(name)&&(!department||x.department===department));
const rows=[
  {name:'張恆瑜',subjects:['會計'],role:'專輔教師／教材審閱教師',match:['張恆瑜','數位金融科技學系']},
  {name:'廖耕億',subjects:['程式設計'],role:'專輔教師／教材審閱教師',match:['廖耕億','數位金融科技學系']},
  {name:'許清山',subjects:['微積分'],role:'專輔教師／教材審閱教師',match:['許清山','通識中心自然學科']},
  {name:'蕭煒翰',subjects:['工程數學'],role:'專輔教師／教材審閱教師',match:['蕭煒翰','電機工程學系']},
  {name:'何金龍',subjects:['物理'],role:'專輔教師／教材審閱教師',match:['何金龍','通識中心自然學科']},
  {name:'譚賢明',subjects:['普通生物'],role:'專輔教師／教材審閱教師',match:['譚賢明','生物醫學研究所']},
  {name:'蕭慧怡',subjects:['普通生物'],role:'專輔教師／教材審閱教師',match:['蕭慧怡','生物醫學研究所']},
  {name:'陳盈汝',subjects:['普通生物'],role:'專輔教師／教材審閱教師',match:['陳盈汝','生物醫學研究所']},
];
data.specialTutors=rows.map((r,i)=>{const f=find(...r.match);return {id:`tutor-${i+1}`,name:r.name,role:r.role,subjects:r.subjects,department:f?.department||'',email:f?.email||'',phone:f?.phone||'',location:f?.location||'長庚大學校內（請以官方公開資料為準）',specialty:f?.specialty||'',profileUrl:f?.profileUrl||'https://www.cgu.edu.tw/academic/Subject/Detail/46541?nodeId=10896',availabilityKey:`t:${i+1}`,source:'長庚大學教務處「專輔教師」公開教材資料頁'};});
data.specialTutorsCount=data.specialTutors.length;
await fs.writeFile(out,JSON.stringify(data,null,2),'utf8');
console.log(`specialTutors=${data.specialTutors.length}`);
