// Explicit opt-in, no credentials and no network implementation. A supervising
// MCP client executes these fixture-scoped statements ONLY against the pinned
// Supabase DEV project and returns JSON rows on stdin. Never use in Production.
import { createInterface } from "node:readline";
import { certifyShadowOpenAiText } from "./certify-shadow-openai-text.mjs";
if(process.argv[2]!=="hjfwjnejbcpmknvfpdcq")throw Error("exact_dev_project_required");
let serial=Promise.resolve(),sequence=0,waiting;
// Avoid the PTY canonical input line cap (~4 KiB): a returned run includes a
// structured snapshot. No echo, browser, socket, secrets or localhost form.
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const lines=createInterface({input:process.stdin});
lines.on("line",line=>{
  const response=JSON.parse(line);
  if(!waiting||response.requestId!==waiting.id)throw Error("bridge_correlation_failed");
  const pending=waiting;waiting=null;
  if(response.error)pending.reject(Object.assign(Error("dev_database_failure"),{code:response.error}));
  else pending.resolve(response.rows);
});
const query=sql=>{
  const next=serial.then(()=>new Promise((resolve,reject)=>{
    waiting={id:++sequence,resolve,reject};
    console.log(JSON.stringify({kind:"sql",requestId:sequence,project:"hjfwjnejbcpmknvfpdcq",sql}));
  }));
  serial=next.catch(()=>{});return next;
};
try{
  if(process.argv[3]==="--bridge-selftest"){
    const rows=await query("bridge-selftest-no-database");
    if(rows?.[0]?.payload?.length!==50000)throw Error("bridge_truncated_input");
    console.log(JSON.stringify({kind:"bridge_selftest",status:"PASS",bytes:50000}));
  }else{
  const result=await certifyShadowOpenAiText(query,{environment:process.argv[2],emit:check=>console.log(JSON.stringify({kind:"check",...check}))});
  console.log(JSON.stringify({kind:"result",...result}));
  }
}catch(error){console.log(JSON.stringify({kind:"failure",code:error.code||"certification_assertion_failed",check:error.message}));process.exitCode=1;}
finally{lines.close();process.stdin.pause();}
