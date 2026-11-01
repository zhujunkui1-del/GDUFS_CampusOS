import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root='D:/tlydcg/Codex_work/广外AI应用大赛';
const read=async p=>JSON.parse(await readFile(root+'/'+p,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const catalog=await read('src/features/campus-map/data/building-model-catalog.json');
const map=await read('src/features/campus-map/data/local-map-manifest.json');
const campus=await read('src/features/campus-map/data/campus.json');
const assets=[];
for(const e of catalog.entries){
 for(const [mode,a] of Object.entries(e.assets)){
   const b=await readFile(root+'/public'+a.url);
   const gltf=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
   assert.equal(sha(b),a.sha256);assert.equal(b.length,a.bytes);
   assert.equal(gltf.images?.length||0,0);assert.equal(gltf.textures?.length||0,0);
   assert(gltf.buffers.every(b=>!b.uri));
   assets.push({key:e.key,mode,bytes:b.length,sha256:a.sha256,images:0,textures:0});
 }
}
const mapBytes=await readFile(root+'/public'+map.url);
assert.equal(sha(mapBytes),map.sha256);assert.equal(mapBytes.length,map.bytes);
const n7=await readFile(root+'/public/models/nanyuan7/nanyuan7-v2-54cc55342ae5.glb');
assert.equal(sha(n7),'54cc55342ae54c2f38743341490fe943de8a877f8a968bc7c46d7a6f2c14b79a');
assert(!catalog.entries.some(e=>e.placeId==='osm-way-312536955'));
assert.equal(campus.places.length,113);
const report={date:'2026-11-01',catalogVersion:catalog.version,buildingUnits:catalog.displayBuildingCount,newBuildingUnits:catalog.newBuildingCount,visualConnectors:catalog.visualConnectorCount,files:assets.length,bytes:assets.reduce((s,a)=>s+a.bytes,0),map:{version:map.version,sha256:map.sha256,features:JSON.parse(mapBytes).features.length,places:campus.places.length},south7:{preserved:true,sha256:sha(n7),bytes:n7.length},assets};
await writeFile(new URL('./asset-audit.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,assets:undefined}));
