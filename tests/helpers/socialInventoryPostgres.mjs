import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { executeSalesTool } from "../../lib/agentsV2/openaiSalesAgent.js";
import { readSocialSalesContext } from "../../lib/social/salesInventory.js";

// Supabase SDK serializes the real application queries. This local fetch adapter
// translates only the allowlisted read filters to parameterized PostgreSQL SQL.
// It is NOT a hosted PostgREST certification and never opens an HTTP connection.
export async function certifySocialInventoryPostgres(pg, check) {
  await pg.query(`alter table propiedades
    add column titulo text, add column operacion text, add column precio numeric,
    add column moneda text, add column tipo text, add column recamaras integer,
    add column banos integer, add column estacionamientos integer, add column m2_construccion numeric,
    add column m2_terreno numeric, add column colonia text, add column ciudad text,
    add column estado text, add column amenidades jsonb, add column mantenimiento_monto numeric,
    add column mantenimiento_aplica boolean, add column fecha_disponibilidad date,
    add column mascotas_permitidas boolean, add column amueblado text, add column creditos_aceptados jsonb,
    add column status text, add column plaza_id uuid, add column direccion text, add column updated_at timestamptz;`);
  const inserted=await pg.query(`insert into propiedades(id,public_id,titulo,operacion,precio,moneda,tipo,recamaras,colonia,ciudad,status,updated_at)
    values(gen_random_uuid(),'EMP-MUN7BHJX','Casa en Venta en Chapulco, Puebla | 3 Recámaras y Vista a la Laguna','sale',1800000,'MXN','Casa',3,'Chapulco','Puebla','published',now()) returning id`);
  const id=inserted.rows[0].id, requests=[];
  const columns=new Set(["id","status","operacion","precio","recamaras","mascotas_permitidas","amueblado","ciudad","tipo","colonia","titulo","direccion","inbound_id","destination","respond_contact_id","source_channel_id","occurred_at"]);
  const client=createClient("https://synthetic-only.invalid","synthetic",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(raw,options)=>{
    const url=new URL(raw);assert.equal(url.origin,"https://synthetic-only.invalid");assert.ok(["/rest/v1/propiedades","/rest/v1/social_message_routes"].includes(url.pathname));assert.equal(options.method,"GET");requests.push(url);
    const values=[],clauses=[];
    const condition=(column,filter)=>{
      assert.ok(columns.has(column));const match=filter.match(/^(eq|neq|ilike|gte|lte)\.(.*)$/s);assert.ok(match);
      const [,op,value]=match;values.push(value);
      return `${column} ${{eq:"=",neq:"<>",ilike:"ilike",gte:">=",lte:"<="}[op]} $${values.length}`;
    };
    for(const [key,value] of url.searchParams){
      if(["select","order","limit"].includes(key))continue;
      if(key==="or"){
        assert.ok(value.startsWith("(")&&value.endsWith(")"));
        clauses.push("("+value.slice(1,-1).split(",").map(part=>{const dot=part.indexOf(".");return condition(part.slice(0,dot),part.slice(dot+1));}).join(" or ")+")");
      }else clauses.push(condition(key,value));
    }
    const limit=Number(url.searchParams.get("limit")||5);assert.ok(limit>0&&limit<=5);values.push(limit);
    const select=url.searchParams.get("select");assert.match(select,/^\w+(,\w+)*$/);
    const table=url.pathname.endsWith("/propiedades")?"propiedades":"social_message_routes";
    const order=url.searchParams.get("order");assert.ok(!order||["updated_at.desc","occurred_at.desc"].includes(order));
    // PostgreSQL JSON encoding mirrors PostgREST numeric JSON, not pg's raw
    // numeric-as-string column parser.
    const result=await pg.query(`select row_to_json(t) row from (select ${select} from ${table} where ${clauses.join(" and ")} ${order?`order by ${order.replace("."," ")}`:""} limit $${values.length}) t`,values);
    return new Response(JSON.stringify(result.rows.map(r=>r.row)),{status:200,headers:{"Content-Type":"application/json"}});
  }}});
  const args={zone:"atrás de la laguna de Chapulco",operation:"sale",propertyType:"Casa"};
  const legacy=await executeSalesTool(client,"search_sales_inventory",args);
  check("inventory: old literal zone false negative reproduced in PostgreSQL",()=>assert.equal(legacy.length,0));
  const socialContext={messageText:"casa atrás de la laguna de Chapulco"};
  const result=await executeSalesTool(client,"search_sales_inventory",args,{socialContext});
  check("inventory: SDK AND-of-OR filters find Chapulco in PostgreSQL",()=>{
    assert.equal(result.listings[0].publicId,"EMP-MUN7BHJX");assert.equal(result.listings[0].price,1800000);
    assert.equal(requests.at(-1).searchParams.getAll("or").length,2);assert.equal(result.sourceConfirmed,false);
  });
  const coverage=await executeSalesTool(client,"check_sales_coverage",{location:args.zone},{socialContext});
  check("coverage: tokenized PostgreSQL query finds published evidence",()=>assert.equal(coverage[0].evidence,"published_inventory_match"));
  const source=await executeSalesTool(client,"search_sales_inventory",{zone:"unrelated"},{socialContext:{sourcePropertyId:id}});
  check("inventory: verified origin precedes textual fallback",()=>{assert.equal(source.sourceConfirmed,true);assert.equal(requests.at(-1).searchParams.get("id"),`eq.${id}`);});
  const budget=await executeSalesTool(client,"search_sales_inventory",{...args,maxPrice:1000000},{socialContext});
  check("inventory: explicit budget preserved, zero rows not global absence",()=>{assert.equal(budget.listings.length,0);assert.equal(budget.searchEvidence.evidence,"no_match_in_bounded_query_not_inventory_absence");});
  // Exercise application attribution SELECTs against the actual migration columns,
  // not a mock that would silently accept a nonexistent selected column.
  let previous=null;
  for(const [n,sourceProperty] of [[1,id],[2,null]]){
    const route={source_event_id:`inventory-${n}`,source_message_id:`inventory-${n}`,respond_contact_id:"inventory-context",source_channel_id:"497382",source_platform:"instagram",destination:"SALES",reason:"sales_intent",identity_status:"unresolved",source_property_id:sourceProperty,previous_route_id:previous?.routeId||null,occurred_at:`2026-10-01T1${n}:00:00Z`,sanitized_text:"Consulta sintética"};
    await pg.query("insert into gv_respond_webhook_events values($1)",[route.source_event_id]);
    const created=(await pg.query("select capture_social_route_v1($1) r",[route])).rows[0].r;
    const context=await readSocialSalesContext(client,{id:created.inboundId,social_route_id:created.routeId,respond_contact_id:route.respond_contact_id,channel_id:route.source_channel_id,sanitized_text:"El conde"},{});
    check(`inventory: actual journal columns and ${n===1?"current":"preceding"} origin resolve`,()=>assert.equal(context.sourceProperty.publicId,"EMP-MUN7BHJX"));
    previous=created;
  }
}
