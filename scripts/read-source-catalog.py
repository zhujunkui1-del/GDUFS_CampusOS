"""Read XLSX/MD as inert local input. No formula evaluation, network or workbook edits."""
import hashlib,json,re,sys,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

root=Path('CampusOS_Codex_完整设计文档_v2')
book=root/'CampusOS_广外信息源_去重详表_2026-10-17.xlsx'
markdown=root/'CampusOS_广外信息源_去重详表_2026-10-17.md'
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def read_book():
 with zipfile.ZipFile(book) as archive:
  if sum(e.file_size for e in archive.infolist())>25000000:raise ValueError('Workbook too large')
  strings=[]
  if 'xl/sharedStrings.xml' in archive.namelist():
   strings=[''.join(n.itertext()) for n in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si',ns)]
  relationships={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
  sheets={}
  for sheet in ET.fromstring(archive.read('xl/workbook.xml')).find('s:sheets',ns):
   name=sheet.attrib['name']
   if name not in ['全渠道去重总表','重复冲突与待核事项']:continue
   target=relationships[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
   target=target.lstrip('/') if target.startswith('/') else 'xl/'+target
   rows=[]
   for row in ET.fromstring(archive.read(target)).findall('s:sheetData/s:row',ns):
    cells={}
    for cell in row:
     if cell.find('s:f',ns) is not None:raise ValueError('Formula cells are not accepted as catalog facts')
     value=cell.find('s:v',ns);kind=cell.attrib.get('t')
     text=''.join(cell.find('s:is',ns).itertext()) if kind=='inlineStr' else (value.text or '' if value is not None else '')
     if kind=='s':text=strings[int(text)]
     cells[re.sub('[0-9]','',cell.attrib['r'])]=text.strip()
    rows.append({'row':int(row.attrib['r']),'cells':cells})
   sheets[name]=rows
  return sheets
text=markdown.read_text(encoding='utf-8')
heads={m.group(1):{'name':m.group(2).strip(),'line':text[:m.start()].count('\n')+1} for m in re.finditer(r'^#### (GDUFS-SRC-\d{4})｜(.+)$',text,re.M)}
data={'files':[{'file':str(path).replace('\\','/'),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in [book,markdown]],'sheets':read_book(),'markdownHeads':heads}
sys.stdout.reconfigure(encoding='utf-8')
print(json.dumps(data,ensure_ascii=False))
