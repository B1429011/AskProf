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
    for attrs, _ in p.links:
        href=attrs.get("href", "")
        if "FullTimeProfessorManagement" in href:
            return urljoin(home_url, href)
    return None

def extract_faculty(html, department, location=""):
    cards=re.split(r'<div class="card card_list pic">', html, flags=re.I)[1:]
    rows=[]
    for card in cards:
        if "card-title" not in card: continue
        name_m=re.search(r'<p class="h4 card-title[^>]*>(.*?)</p>', card, re.S|re.I)
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

def main():
    directory_html=get(DIRECTORY)
    departments=extract_departments(directory_html)
    faculty=[]; failures=[]
    for i,d in enumerate(departments, 1):
        try:
            home=get(d["url"]); location_m=re.search(r'學系位置：\s*([^<]+)', home, re.S); d["location"]=clean(location_m.group(1)) if location_m else ""
            f_url=find_faculty_url(d["url"], home)
            d["facultyUrl"]=f_url or ""
            if f_url:
                faculty.extend(extract_faculty(get(f_url), d["name"], d.get("location", "")))
            else: failures.append({"department":d["name"],"reason":"官方系所頁未找到專任教師入口"})
        except Exception as e:
            failures.append({"department":d["name"],"reason":str(e)})
        print(f"[{i}/{len(departments)}] {d['name']}")
        time.sleep(0.15)
    payload={"source":"長庚大學官方網站","directoryUrl":DIRECTORY,"fetchedAt":time.strftime("%Y-%m-%d"),"notice":"公開資料僅供查詢；學生個人課表與教授私人行事曆不在此檔案。","departments":departments,"faculty":faculty,"failures":failures}
    OUT.parent.mkdir(parents=True, exist_ok=True); OUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"departments={len(departments)} faculty={len(faculty)} failures={len(failures)} output={OUT}")

if __name__ == "__main__": main()
