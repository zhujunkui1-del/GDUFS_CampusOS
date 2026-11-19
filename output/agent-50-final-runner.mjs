import {spawnSync} from "node:child_process";
const env={...process.env,AGENT_MATRIX_LIVE:"1",AGENT_MATRIX_PROVIDER:"deepseek",AGENT_MATRIX_MODEL:process.env.MODEL_NAME,AGENT_MATRIX_MODEL_KEY:process.env.MODEL_API_KEY,AGENT_MATRIX_MODEL_BASE:process.env.MODEL_BASE_URL,AGENT_MATRIX_CORPUS:"output/agent-50-expanded-corpus.json",AGENT_MATRIX_TOKEN_LIMIT:"1800000"};
const batches=[["live-6","T34,T37"],["live-followup","T35"]];
for(const [phase,ids] of batches){
 const r=spawnSync(process.execPath,["node_modules/vitest/vitest.mjs","run","tests/unit/agent-50-matrix.test.ts"],{env:{...env,AGENT_MATRIX_PHASE:phase,AGENT_MATRIX_IDS:ids, ...(phase==="live-followup"?{AGENT_MATRIX_FOLLOWUP:"那需要笔试吗？"}:{})},stdio:"inherit"});
 if(r.status!==0){process.exitCode=1;break;}
}


