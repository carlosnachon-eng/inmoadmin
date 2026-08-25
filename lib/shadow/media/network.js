import dns from "node:dns/promises";
import net from "node:net";
import https from "node:https";
import crypto from "node:crypto";
import { validateOpaqueMediaUrl } from "./reference.js";

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const BLOCKED_V4 = [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.168.0.0",16],["198.18.0.0",15],["224.0.0.0",4],["240.0.0.0",4]];
const ipv4Int=(ip)=>ip.split(".").reduce((n,p)=>(n*256+Number(p))>>>0,0);
const inV4=(ip,base,bits)=>bits===0||((ipv4Int(ip) >>> (32-bits))===(ipv4Int(base) >>> (32-bits)));

export function isBlockedIp(address) {
  const version = net.isIP(address);
  if (!version) return true;
  if (version === 4) return BLOCKED_V4.some(([base,bits])=>inV4(address,base,bits));
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff")) return true;
  if (normalized.startsWith("::ffff:")) return isBlockedIp(normalized.slice(7));
  return false;
}

export async function resolvePublicHost(hostname, { resolver = dns.lookup } = {}) {
  const records = await resolver(hostname, { all: true, verbatim: true });
  if (!Array.isArray(records) || !records.length || records.some((item)=>isBlockedIp(item.address))) throw Object.assign(new Error("rejected_network_target"), { code: "rejected_network_target" });
  return records;
}

function normalizePinnedRecord(record) {
  const address=typeof record?.address==="string"?record.address:"";
  const detectedFamily=net.isIP(address);
  const declaredFamily=record?.family==="IPv4"?4:record?.family==="IPv6"?6:Number(record?.family);
  if(!detectedFamily||declaredFamily!==detectedFamily)throw Object.assign(new Error("invalid_pinned_address"),{code:"invalid_pinned_address"});
  return{address,family:detectedFamily};
}

// Node enables autoSelectFamily by default in modern runtimes. In that mode it
// calls custom lookup functions with options.all=true and requires an array of
// address records. Older/scalar callers still require (address, family).
// Supporting both shapes keeps the socket pinned to the already validated IP.
export function createPinnedLookup(record) {
  const pinned=normalizePinnedRecord(record);
  return(_hostname,options,callback)=>{
    const cb=typeof options==="function"?options:callback;
    const lookupOptions=typeof options==="object"&&options!==null?options:{};
    if(typeof cb!=="function")throw Object.assign(new Error("invalid_lookup_callback"),{code:"invalid_lookup_callback"});
    if(lookupOptions.all===true)return cb(null,[{...pinned}]);
    return cb(null,pinned.address,pinned.family);
  };
}

function requestOnce(url, records, { request = https.request, connectTimeoutMs = 3_000 } = {}) {
  return new Promise((resolve,reject)=>{
    const req=request({protocol:"https:",hostname:url.hostname,port:url.port||443,path:`${url.pathname}${url.search}`,method:"GET",servername:url.hostname,headers:{accept:"application/octet-stream","user-agent":"inmoadmin-shadow-media/1"},lookup:createPinnedLookup(records[0]),timeout:connectTimeoutMs},resolve);
    req.on("timeout",()=>req.destroy(Object.assign(new Error("media_connect_timeout"),{code:"media_connect_timeout"})));
    req.setTimeout?.(connectTimeoutMs);
    req.on("error",reject);req.end();
  });
}

async function readLimited(res,{maxBytes=MAX_MEDIA_BYTES}={}){
  const declared=Number(res.headers?.["content-length"]||0);if(declared>maxBytes)throw Object.assign(new Error("media_too_large"),{code:"media_too_large"});
  const chunks=[];let size=0;for await(const chunk of res){size+=chunk.length;if(size>maxBytes){res.destroy();throw Object.assign(new Error("media_too_large"),{code:"media_too_large"});}chunks.push(chunk);}return Buffer.concat(chunks,size);
}

async function secureDownloadInternal(initial,{resolver=dns.lookup,request=https.request,maxRedirects=2,connectTimeoutMs=3_000,maxBytes=MAX_MEDIA_BYTES}={}){
  let url=validateOpaqueMediaUrl(initial);
  for(let hop=0;hop<=maxRedirects;hop+=1){
    let records;try{records=await resolvePublicHost(url.hostname,{resolver});}catch(error){if(hop>0)throw Object.assign(new Error("rejected_redirect_target"),{code:"rejected_redirect_target"});throw error;}
    const res=await requestOnce(url,records,{request,connectTimeoutMs});
    if([301,302,303,307,308].includes(res.statusCode)){
      res.resume();if(hop===maxRedirects)throw Object.assign(new Error("too_many_redirects"),{code:"too_many_redirects"});
      let target;try{target=validateOpaqueMediaUrl(new URL(res.headers.location,url).href);}catch{throw Object.assign(new Error("rejected_redirect_target"),{code:"rejected_redirect_target"});}
      url=target;continue;
    }
    if([404,409,423,425,429,503].includes(res.statusCode))throw Object.assign(new Error("pending_media_unavailable"),{code:"pending_media_unavailable",retryable:true});
    if(res.statusCode<200||res.statusCode>=300)throw Object.assign(new Error("media_http_error"),{code:"media_http_error"});
    const buffer=await readLimited(res,{maxBytes});return{buffer,headerMime:String(res.headers?.["content-type"]||"").toLowerCase().split(";",1)[0]||null,sha256:crypto.createHash("sha256").update(buffer).digest("hex")};
  }
  throw new Error("unreachable");
}

export async function secureDownload(initial,options={}){
  const totalTimeoutMs=Math.min(10_000,Math.max(1,Number(options.timeoutMs)||10_000));
  let timer;
  try{return await Promise.race([secureDownloadInternal(initial,options),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error("media_download_timeout"),{code:"media_download_timeout"})),totalTimeoutMs);})]);}
  finally{clearTimeout(timer);}
}

export function detectMime(buffer){
  if(buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])))return"image/jpeg";
  if(buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return"image/png";
  if(buffer.subarray(0,4).toString()==="RIFF"&&buffer.subarray(8,12).toString()==="WEBP")return"image/webp";
  if(buffer.subarray(0,5).toString()==="%PDF-")return"application/pdf";
  return null;
}

export async function validateDownloadedMedia(download,{declaredMime,pdfParser}={}){
  const magicMime=detectMime(download.buffer);if(!magicMime)throw Object.assign(new Error("unsupported_or_invalid_magic"),{code:"unsupported_or_invalid_magic"});
  if(declaredMime&&declaredMime!==magicMime)throw Object.assign(new Error("mime_mismatch"),{code:"mime_mismatch"});
  if(download.headerMime&&download.headerMime!=="application/octet-stream"&&download.headerMime!==magicMime)throw Object.assign(new Error("mime_mismatch"),{code:"mime_mismatch"});
  let pages=null;if(magicMime==="application/pdf"){
    try{const parse=pdfParser??(await import("pdf-parse")).default;const parsed=await parse(download.buffer);pages=Number(parsed.numpages);if(!Number.isInteger(pages)||pages<1)throw new Error("bad_pages");if(pages>10)throw Object.assign(new Error("pdf_page_limit"),{code:"pdf_page_limit"});}
    catch(error){if(error?.code==="pdf_page_limit")throw error;throw Object.assign(new Error("invalid_or_encrypted_pdf"),{code:"invalid_or_encrypted_pdf"});}
  }
  return{validatedMime:magicMime,validatedSize:download.buffer.length,sha256:download.sha256,pages};
}
