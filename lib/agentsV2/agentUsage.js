const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

// Strict projection for callers requiring unknown != zero. Existing V2 callers
// retain their interface. Cached/reasoning are subsets, never added twice.
export function knownAgentUsage(value) {
  const n = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const inputTokens = n(value?.input_tokens), outputTokens = n(value?.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  const cachedInputTokens = n(value?.input_tokens_details?.cached_tokens);
  const reasoningTokens = n(value?.output_tokens_details?.reasoning_tokens);
  if (cachedInputTokens > inputTokens || reasoningTokens > outputTokens) return null;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cachedInputTokens, reasoningTokens };
}

const PRICE_PER_MILLION=Object.freeze({
  "gpt-6-luna":{input:0.10,cached:0.01,output:0.50},
  "gpt-5.6-luna":{input:0.20,output:1.20},
  "gpt-5.6-terra":{input:2.00,output:12.00},
  "gpt-5.6-sol":{input:4.00,output:20.00}
});

export async function getAgentSessionUsage(sessionId,{env=process.env,fetchImpl=fetch}={}){
  if(!sessionId||String(sessionId).startsWith("human-review-"))return{inputTokens:0,outputTokens:0,totalTokens:0};
  const headers={Authorization:"Bearer "+env.OPENAI_API_KEY,"OpenAI-Beta":"agents=v1"};
  let turns=[];
  for(const delay of [0,500,1200,2500]){
    if(delay)await sleep(delay);
    const r=await fetchImpl("https://api.openai.com/v1/agents/sessions/"+encodeURIComponent(sessionId)+"/turns?order=asc&limit=100",{headers});
    const b=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error("agent_usage_turns_failed_"+r.status);
    turns=Array.isArray(b?.data)?b.data:[];
    if(turns.some(t=>t?.usage))break;
  }
  return turns.reduce((acc,t)=>{
    const u=t?.usage||{};
    acc.inputTokens+=Number(u.input_tokens||0);
    acc.cachedInputTokens+=Number(u.input_tokens_details?.cached_tokens||0);
    acc.outputTokens+=Number(u.output_tokens||0);
    acc.reasoningTokens+=Number(u.output_tokens_details?.reasoning_tokens||0);
    acc.totalTokens+=Number(u.total_tokens||0);
    return acc;
  },{inputTokens:0,cachedInputTokens:0,outputTokens:0,reasoningTokens:0,totalTokens:0});
}

export function estimateAgentCostUsd(model,usage,env=process.env){
  const name=String(model||"").toLowerCase();
  const configuredInput=Number(env.AI_COST_INPUT_USD_PER_MILLION||NaN);
  const configuredOutput=Number(env.AI_COST_OUTPUT_USD_PER_MILLION||NaN);
  const rate=Number.isFinite(configuredInput)&&Number.isFinite(configuredOutput)
    ?{input:configuredInput,output:configuredOutput}
    :PRICE_PER_MILLION[name];
  if(!rate)return null;
  const input=Number(usage?.inputTokens||0);
  const cached=Math.min(input,Number(usage?.cachedInputTokens||0));
  const uncached=Math.max(0,input-cached);
  const cachedRate=Number.isFinite(rate.cached)?rate.cached:rate.input;
  return Number(((uncached*rate.input+cached*cachedRate+Number(usage?.outputTokens||0)*rate.output)/1_000_000).toFixed(8));
}

export async function safeAgentUsage(sessionId,{model,env=process.env}={}){
  try{
    const usage=await getAgentSessionUsage(sessionId,{env});
    return{...usage,estimatedCostUsd:estimateAgentCostUsd(model,usage,env)};
  }catch(error){
    console.error("[agent-usage]",String(error?.message||"usage_failed").slice(0,120));
    return{inputTokens:null,cachedInputTokens:null,outputTokens:null,reasoningTokens:null,totalTokens:null,estimatedCostUsd:null};
  }
}
