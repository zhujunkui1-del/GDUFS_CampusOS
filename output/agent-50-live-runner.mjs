import {spawnSync} from "node:child_process";
const env={...process.env,AGENT_MATRIX_LIVE:"1",AGENT_MATRIX_PROVIDER:"deepseek",AGENT_MATRIX_MODEL:process.env.MODEL_NAME,AGENT_MATRIX_MODEL_KEY:process.env.MODEL_API_KEY,AGENT_MATRIX_MODEL_BASE:process.env.MODEL_BASE_URL,AGENT_MATRIX_CORPUS:"output/agent-50-isolated-corpus.json",AGENT_MATRIX_TOKEN_LIMIT:"1800000"};
const batches=[["live-1","T35,T39,T43"],["live-2","T28,T31,T32,T33,T34"],["live-3","T36,T37,T38,T40,T44,T45"]];
for(const [phase,ids] of batches){
 const r=spawnSync(process.execPath,["node_modules/vitest/vitest.mjs","run","tests/unit/agent-50-matrix.test.ts"],{env:{...env,AGENT_MATRIX_PHASE:phase,AGENT_MATRIX_IDS:ids},stdio:"inherit"});
 if(r.status!==0){process.exitCode=1;break;}
}
