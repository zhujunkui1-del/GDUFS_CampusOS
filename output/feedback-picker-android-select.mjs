import {execFileSync} from 'node:child_process';
const adb='D:/Android/sdk/platform-tools/adb.exe';
const run=(...args)=>execFileSync(adb,['-s','emulator-5554',...args],{timeout:18000,encoding:'utf8'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function dump(){run('shell','uiautomator','dump','/sdcard/feedback-test.xml');return run('shell','cat','/sdcard/feedback-test.xml');}
function tap(label){const entry=dump().match(/<node\b[^>]+>/g)?.find(x=>x.includes('text="'+label+'"')||x.includes('content-desc="'+label+'"'));if(!entry)throw Error('Missing '+label);const m=entry.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);run('shell','input','tap',String((+m[1]+ +m[3])>>1),String((+m[2]+ +m[4])>>1));}
if(!dump().includes('关闭留言区'))tap('留言区');await sleep(350);
const form=dump();const edit=form.match(/<node\b[^>]+>/g)?.filter(x=>x.includes('class="android.widget.EditText"')).at(-1);
if(edit){const m=edit.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);run('shell','input','tap',String((+m[1]+ +m[3])>>1),String((+m[2]+ +m[4])>>1));run('shell','input','text','PreserveDraft');run('shell','input','keyevent','4');await sleep(500);}
tap('上传图片');await sleep(900);
const picker=run('shell','dumpsys','activity','activities').split('\n').find(l=>l.includes('topResumedActivity'));
if(!picker||!/documentsui|photopicker|mediaprovider/i.test(picker))throw Error('System picker not in foreground: '+picker);
console.log(picker.trim());
const photo=dump().match(/<node\b[^>]+>/g).find(n=>n.includes('content-desc="Photo taken'));
if(!photo) throw Error('No test photo');
const match=photo.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
run('shell','input','tap',String((+match[1]+ +match[3])>>1),String((+match[2]+ +match[4])>>1));
tap('Add (1)');await sleep(600);
const after=dump();
const entries=after.match(/<node\b[^>]+>/g).filter(e=>/PreserveDraft|picker-test|移除图片/.test(e));
console.log(entries.map(e=>e.match(/text="([^"]*)"/)?.[1]));
if(!after.includes('PreserveDraft')||!after.includes('移除图片'))throw Error('Draft or selected image missing');
console.log('APK confirmed selected image back in the existing draft.');
