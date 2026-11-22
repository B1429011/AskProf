"""Fetch public CGU department and faculty directory data.

Sources are kept in the output so the site can show where each record came from.
This intentionally does not fetch student records or private timetables.
"""
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen
import json, re, time

ROOT = "https://www.cgu.edu.tw/"
DIRECTORY = "https://www.cgu.edu.tw/ch/Contents?nodeId=269"
OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "cgu_public.json"

def get(url):
    req = Request(url, headers={"User-Agent": "LearningNavigation/0.1 public-data-import"})
    with urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", "ignore")

class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.links=[]; self.current=None; self.buf=[]
    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.current=dict(attrs); self.buf=[]
    def handle_data(self, data):
        if self.current is not None: self.buf.append(data)
    def handle_endtag(self, tag):
        if tag == "a" and self.current is not None:
            self.links.append((self.current, " ".join("".join(self.buf).split())))
            self.current=None; self.buf=[]

def clean(s):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", s))).strip()

def extract_departments(html):
    p=LinkParser(); p.feed(html); out=[]; seen=set()
    for attrs, text in p.links:
        title=clean(attrs.get("title", "")); href=attrs.get("href", "")
        if not href or not text or not title or "(另開" not in title: continue
        if not (href.startswith("https://www.cgu.edu.tw/") or href.startswith("/")): continue
        name=title.replace("(另開分頁)", "").replace("(另開新頁)", "").strip()
        if not any(x in name for x in ("學系", "研究所", "研究院", "學程")): continue
        url=urljoin(ROOT, href)
        if (name,url) in seen: continue
        seen.add((name,url)); out.append({"name":name,"url":url})
    return out

def find_faculty_url(home_url, html):
    p=LinkParser(); p.feed(html)
    candidates=[]
    for attrs, _ in p.links:
        href=attrs.get("href", "")
        title=clean(attrs.get("title", ""))
        if "FullTimeProfessorManagement" in href:
            candidates.append((0,urljoin(home_url, href)))
        elif any(word in title for word in ("專任師資", "師資資訊", "專任教師", "教學師資")):
            candidates.append((1,urljoin(home_url, href)))
    if candidates:
        candidates.sort(key=lambda item:item[0]); return candidates[0][1]
    return None

def extract_faculty(html, department, location=""):
    cards=re.split(r'<div class="card card_list pic">', html, flags=re.I)[1:]
    rows=[]
    for card in cards:
        if "card-title" not in card: continue
        name_m=re.search(r'<(?:p|h[1-6])[^>]*class="[^"]*card-title[^>]*>(.*?)</(?:p|h[1-6])>', card, re.S|re.I)
        if not name_m: continue
        name=clean(name_m.group(1))
        if not name: continue
        email=(re.search(r'mailto:([^"?]+)', card, re.I) or [None,""])[1]
        phone_m=re.search(r'電話：\s*([^<]+)', card, re.S)
        specialty_m=re.search(r'專長領域：\s*([^<]+)', card, re.S)
        degree_m=re.search(r'學歷：\s*([^<]+)', card, re.S)
        detail_m=re.search(r'href="([^"]*FullTimeProfessorManagement/Detail/[^"]+)"', card, re.I)
        rows.append({"name":name,"department":department,"location":location,"email":email,"phone":clean(phone_m.group(1)) if phone_m else "","degree":clean(degree_m.group(1)) if degree_m else "","specialty":clean(specialty_m.group(1)) if specialty_m else "","profileUrl":urljoin(ROOT, detail_m.group(1)) if detail_m else ""})
    return rows

def extract_subject_cards(html, department, location=""):
    """Parse newer CGU Subject pages, whose faculty cards use h5.card-title."""
    rows=[]; seen=set()
    pattern=re.compile(r'<a[^>]+href="([^"]*(?:Subject/Detail|Contents\?nodeId=)[^"]*)"[^>]+title="([^"]*(?:教授|副教授|助理教授|講師)[^"]*)"[^>]*>(.*?)</a>', re.S|re.I)
    for m in pattern.finditer(html):
        href,title,body=m.groups(); name=clean(title)
        if not name or name in seen: continue
        seen.add(name); text=clean(body)
        email_m=re.search(r'(?:mailto:|信箱[:：]?\s*)([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})', body, re.I)
        phone_m=re.search(r'(?:電話|分機)[:：]?\s*([^<\n]+)', body, re.I)
        specialty_m=re.search(r'(?:專長|研究方向|研究領域)[:：]?\s*([^<\n]+)', body, re.I)
        rows.append({"name":name,"department":department,"location":location,"email":email_m.group(1) if email_m else "","phone":clean(phone_m.group(1)) if phone_m else "","degree":"","specialty":clean(specialty_m.group(1)) if specialty_m else text[:180],"profileUrl":urljoin(ROOT, href)})
    return rows

def extract_title_faculty(html, department, location=""):
    """Parse older pages (notably medicine) that publish faculty as linked image titles."""
    rows=[]; seen=set()
    for href,title in re.findall(r'<a[^>]+href="([^"]+)"[^>]+title="([^"]+)"[^>]*>', html, re.I):
        if not re.search(r'(教授|副教授|助理教授|講師)', title) or title in seen: continue
        if any(x in title for x in ("辦法", "課程", "教師升等")): continue
        seen.add(title)
        rows.append({"name":clean(title),"department":department,"location":location,"email":"","phone":"","degree":"","specialty":"","profileUrl":urljoin(ROOT, href)})
    return rows

def faculty_pages(first_url):
    """Yield a faculty page and any server-side pagination pages linked from it."""
    current=first_url; visited=set(); count=0
    while current and current not in visited and count < 30:
        visited.add(current); html=get(current); yield html
        next_urls=re.findall(r'href="([^"]*SwitchPage[^"]*page=(\d+)[^"]*)"', html, re.I)
        current=urljoin(current, next_urls[0][0]) if next_urls else None; count+=1

def main():
    directory_html=get(DIRECTORY)
    departments=extract_departments(directory_html)
    faculty=[]; failures=[]
    for i,d in enumerate(departments, 1):
        try:
            home=get(d["url"]); location_m=re.search(r'(?:學系|系所)位置：\s*([^<]+)', home, re.S); d["location"]=clean(location_m.group(1)) if location_m else ""
            f_url=find_faculty_url(d["url"], home)
            d["facultyUrl"]=f_url or ""
            if f_url:
                for faculty_html in faculty_pages(f_url):
                    rows=extract_faculty(faculty_html, d["name"], d.get("location", ""))
                    if not rows: rows=extract_subject_cards(faculty_html, d["name"], d.get("location", ""))
                    if not rows: rows=extract_title_faculty(faculty_html, d["name"], d.get("location", ""))
                    faculty.extend(rows)
            else: failures.append({"department":d["name"],"reason":"官方系所頁未找到專任教師入口"})
        except Exception as e:
            failures.append({"department":d["name"],"reason":str(e)})
        print(f"[{i}/{len(departments)}] {d['name']}")
        time.sleep(0.15)
    payload={"source":"長庚大學官方網站","directoryUrl":DIRECTORY,"fetchedAt":time.strftime("%Y-%m-%d"),"notice":"公開資料僅供查詢；學生個人課表與教授私人行事曆不在此檔案。","departments":departments,"faculty":faculty,"failures":failures}
    OUT.parent.mkdir(parents=True, exist_ok=True); OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"departments={len(departments)} faculty={len(faculty)} failures={len(failures)} output={OUT}")

if __name__ == "__main__": main()
