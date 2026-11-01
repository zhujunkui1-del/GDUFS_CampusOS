import { readFile,writeFile } from 'node:fs/promises';
const code=await readFile(new URL('./batch-1.code.txt',import.meta.url),'utf8');
const row={key:'teaching-C',id:'osm-way-1410412691',name:'教学楼C栋'};
await writeFile(new URL('./recheck-C.code.txt',import.meta.url),code.replace(/ for\(const row of .*$/m,' for(const row of '+JSON.stringify([row])+'){'));
