// Local read-only verifier. No dotenv, uploads, model/provider calls, writes or PDF transformations.
import { readFile } from "node:fs/promises";
import { verifyMaterialBytes } from "../lib/ownerMaterials/assets.js";
const paths=process.argv.slice(2);
if(paths.length!==2)throw new Error("Usage: node scripts/verify-owner-approved-materials.mjs <approved-rent.pdf> <approved-sale.pdf>");
const manifest=JSON.parse(await readFile(new URL("../docs/evidence/owner-approved-materials-assets.json",import.meta.url),"utf8"));
for(const [i,asset] of manifest.materials.entries()){
  verifyMaterialBytes(await readFile(paths[i]),asset);
  console.log(JSON.stringify({code:asset.code,version:asset.version,sha256:asset.sha256,byte_size:asset.byte_size,status:"PASS",uploaded:false}));
}
