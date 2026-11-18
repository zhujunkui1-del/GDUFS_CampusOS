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
run('shell','input','keyevent','4');await sleep(800);
const after=dump();
if(!after.includes('留言内容')||edit&&!after.includes('PreserveDraft')||!after.includes('移除图片'))throw Error('Feedback draft absent after pick cancellation');
console.log('Android system picker and cancellation verified, draft entered='+!!edit);


