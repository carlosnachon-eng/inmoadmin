// Test-only PostgREST-shaped adapter to real loopback PostgreSQL. No production
// credentials, fetch, decision logic or guard behavior are implemented here.
export function localPgAdapter(client, hooks = {}) {
  const ident = value => { if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw Error("invalid_test_identifier"); return '"'+value+'"'; };
  const serial = value => JSON.parse(JSON.stringify(value));
  return {
    async rpc(name, args) {
      try {
        await hooks.beforeRpc?.(name,args);
        const keys=Object.keys(args);
        const result=await client.query(`select public.${ident(name)}(${keys.map((k,i)=>`${ident(k)} => $${i+1}`).join(",")}) as result`,Object.values(args));
        await hooks.afterRpc?.(name,args,result.rows[0].result);
        return {data:serial(result.rows[0].result),error:null};
      } catch(error) { return {data:null,error}; }
    },
    from(table) {
      let op="select",payload,columns="*",filters=[],order=[],limit,one=false;
      const q={
        select(v="*"){columns=v;return q;}, insert(p){op="insert";payload=p;return q;},update(p){op="update";payload=p;return q;},
        eq(k,v){filters.push([k,"=",v]);return q;},neq(k,v){filters.push([k,"<>",v]);return q;},
        gt(k,v){filters.push([k,">",v]);return q;},gte(k,v){filters.push([k,">=",v]);return q;},lte(k,v){filters.push([k,"<=",v]);return q;},
        in(k,v){filters.push([k,"in",v]);return q;},is(k,v){filters.push([k,"is",v]);return q;},
        not(k,operator,v){if(operator!=="is"||v!==null)throw Error("unsupported_test_filter");filters.push([k,"not null",null]);return q;},
        order(k,o){order.push(`${ident(k)} ${o?.ascending===false?"desc":"asc"}`);return q;},limit(n){limit=Number(n);return q;},
        maybeSingle(){one=true;return q;},single(){one=true;return q;},
        async then(ok,fail){
          try{
            const values=[],bind=v=>{values.push(Array.isArray(v)?JSON.stringify(v):v);return "$"+values.length;};
            const where=()=>filters.length?" where "+filters.map(([k,cmp,v])=>cmp==="in"?`${ident(k)} in (${v.map(bind).join(",")})`:cmp==="not null"?`${ident(k)} is not null`:cmp==="is"?`${ident(k)} is ${v===null?"null":"not null"}`:`${ident(k)} ${cmp} ${bind(v)}`).join(" and "):"";
            let sql;
            if(op==="insert")sql=`insert into public.${ident(table)} (${Object.keys(payload).map(ident).join(",")}) values (${Object.values(payload).map(bind).join(",")}) returning *`;
            else if(op==="update")sql=`update public.${ident(table)} set ${Object.entries(payload).map(([k,v])=>`${ident(k)}=${bind(v)}`).join(",")}${where()} returning *`;
            else sql=`select * from public.${ident(table)}${where()}${order.length?" order by "+order.join(","):""}${limit!==undefined?" limit "+limit:""}`;
            const result=await client.query(sql,values);
            const rows=result.rows;
            if(columns.includes("sales_agent_v2_inbound_messages("))for(const row of rows)
              row.sales_agent_v2_inbound_messages=(await client.query("select * from sales_agent_v2_inbound_messages where id=$1",[row.inbound_message_id])).rows[0];
            await hooks.afterQuery?.(table,op,payload,rows);
            return ok({data:serial(one?rows[0]||null:rows),error:null});
          }catch(error){return ok({data:null,error});}
        },
      };return q;
    },
  };
}
