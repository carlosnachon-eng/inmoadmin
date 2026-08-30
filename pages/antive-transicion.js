import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  TRANSITION_VIEWER_ROLE,
  activeTransitionMembership,
  buildTransitionViewerSummary,
} from "../lib/condominios/transitionViewer.mjs";

const fmt = (value) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value || 0));
const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const tabs = [["resumen", "Resumen"], ["unidades", "Unidades"], ["cobranza", "Cobranza"], ["historico", "Histórico Antive"], ["proveedores", "Proveedores"], ["pendientes", "Pendientes e incidencias"]];

function Login() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const sendOtp = async () => {
    setLoading(true); setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/antive-transicion` },
    });
    setMessage(error ? "No fue posible solicitar el acceso. Verifica tu correo con Administración." : "Revisa tu correo para continuar.");
    setLoading(false);
  };
  return <main style={styles.center}><section style={styles.login}>
    <p style={styles.eyebrow}>InmoAdmin · acceso externo</p>
    <h1 style={styles.title}>Antive — Transición / Consulta</h1>
    <p style={styles.muted}>Acceso individual de sólo lectura. La cuenta debe haber sido habilitada previamente.</p>
    <label style={styles.label}>Correo autorizado</label>
    <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} style={styles.input} autoComplete="email" />
    <button type="button" onClick={sendOtp} disabled={loading || !email.trim()} style={styles.primary}>{loading ? "Solicitando…" : "Solicitar código de acceso"}</button>
    {message && <p style={styles.notice}>{message}</p>}
  </section></main>;
}

function Denied({ message = "Esta identidad no tiene una membresía de consulta activa." }) {
  return <main style={styles.center}><section style={styles.login}><h1 style={styles.title}>Acceso no disponible</h1><p style={styles.muted}>{message}</p><button type="button" onClick={() => supabase.auth.signOut()} style={styles.secondary}>Cerrar sesión</button></section></main>;
}

export default function AntiveTransitionViewer() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState("resumen");
  const [scope, setScope] = useState(null);
  const [data, setData] = useState({ units: [], fees: [], accounts: [], payments: [], recoveries: [], providers: [], transition: [], incidents: [], controls: null });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: auth }) => { setSession(auth.session); if (!auth.session) setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    let mounted = true;
    const load = async () => {
      setLoading(true); setDenied(false);
      const { data: profile, error: profileError } = await supabase.from("profiles").select("id, role_id, active, roles:role_id(id,nombre,es_externo)").eq("id", session.user.id).maybeSingle();
      if (profileError || !profile?.active || profile.role_id !== TRANSITION_VIEWER_ROLE || profile.roles?.es_externo !== true) {
        if (mounted) { setDenied(true); setLoading(false); }
        return;
      }
      const { data: memberships, error: membershipError } = await supabase.from("condominium_access_memberships").select("condominio_id, access_role, can_view_units, can_view_history, can_view_providers, can_view_transition, can_edit_transition, active, expires_at").eq("principal_user_id", session.user.id);
      const membership = (memberships || []).find((row) => activeTransitionMembership(row));
      if (membershipError || !membership || membership.can_edit_transition || !membership.can_view_units || !membership.can_view_history || !membership.can_view_providers || !membership.can_view_transition) {
        if (mounted) { setDenied(true); setLoading(false); }
        return;
      }
      const condoId = membership.condominio_id;
      const results = await Promise.all([
        supabase.from("condominios").select("id,nombre,cuota_mensual").eq("id", condoId).maybeSingle(),
        supabase.from("unidades_condominio").select("id,numero,activo").eq("condominio_id", condoId).order("numero"),
        supabase.from("cuotas_condominio").select("id,unidad_id,periodo,monto,status,fecha_vencimiento,fecha_pago").eq("condominio_id", condoId).order("periodo", { ascending: false }),
        supabase.from("condominium_historical_accounts").select("id,unidad_id,cutoff_date,reported_charges,reported_payments,reported_balance,review_status,source_organization,source_label").eq("condominio_id", condoId),
        supabase.from("condominium_historical_payments").select("id,unidad_id,historical_account_id,reported_period,reported_amount,received_by,review_status").eq("condominio_id", condoId),
        supabase.from("condominium_historical_recoveries").select("id,unidad_id,historical_account_id,amount,collected_at,status").eq("condominio_id", condoId),
        supabase.from("condominium_provider_preparations").select("id,service_category,provider_name,preliminary_amount,frequency,documentation_status,approved_budget").eq("condominio_id", condoId),
        supabase.from("condominium_transition_items").select("id,category,title,operational_status,legal_responsibility_status,created_at,updated_at").eq("condominio_id", condoId),
        supabase.from("maintenance_tickets").select("id,title,category,priority,status,created_at").eq("condominio_id", condoId),
        supabase.from("condominium_operation_controls").select("lifecycle_status,owner_portal_enabled,communications_enabled,current_billing_enabled,receipts_enabled,real_payments_enabled,money_movements_enabled").eq("condominio_id", condoId).maybeSingle(),
      ]);
      if (results.some((result) => result.error) || !results[0].data) {
        if (mounted) { setDenied(true); setLoading(false); }
        return;
      }
      if (mounted) {
        setScope({ membership, condominium: results[0].data });
        setData({ units: results[1].data || [], fees: results[2].data || [], accounts: results[3].data || [], payments: results[4].data || [], recoveries: results[5].data || [], providers: results[6].data || [], transition: results[7].data || [], incidents: results[8].data || [], controls: results[9].data || null });
        setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [session?.user?.id]);

  const summary = useMemo(() => buildTransitionViewerSummary({ units: data.units, fees: data.fees, historicalAccounts: data.accounts, recoveries: data.recoveries }), [data]);
  const unitNumber = useMemo(() => new Map(data.units.map((row) => [row.id, row.numero])), [data.units]);

  if (!session && !loading) return <Login />;
  if (loading) return <main style={styles.center}>Validando acceso…</main>;
  if (denied || !scope) return <Denied />;

  return <main style={styles.page}>
    <header style={styles.header}><div><p style={styles.eyebrow}>Vista externa · sólo consulta</p><h1 style={styles.title}>{scope.condominium.nombre}</h1><p style={styles.muted}>Supervisión transitoria de Grupo Antive. No permite modificar información.</p></div><button type="button" onClick={() => supabase.auth.signOut()} style={styles.secondary}>Cerrar sesión</button></header>
    <nav style={styles.tabs}>{tabs.map(([id,label]) => <button type="button" key={id} onClick={() => setTab(id)} style={tab === id ? styles.activeTab : styles.tab}>{label}</button>)}</nav>
    {tab === "resumen" && <section style={styles.grid}>{[["Unidades",summary.unitCount],["Cobranza corriente emitida",fmt(summary.currentIssued)],["Cobranza conciliada",fmt(summary.currentCollected)],["Cobranza pendiente",fmt(summary.currentPending)],["Eficiencia corriente",pct(summary.currentCollectionRate)],["Saldo histórico inicial",fmt(summary.historicalInitial)],["Recuperado histórico",fmt(summary.historicalRecovered)],["Saldo histórico pendiente",fmt(summary.historicalPending)]].map(([label,value]) => <article key={label} style={styles.card}><p style={styles.eyebrow}>{label}</p><strong style={styles.metric}>{value}</strong></article>)}</section>}
    {tab === "unidades" && <Table headers={["Unidad","Estado"]} rows={data.units.map((row) => [row.numero,row.activo ? "Activa" : "Inactiva"])} />}
    {tab === "cobranza" && <Table headers={["Unidad","Periodo","Importe","Estado","Conciliado"]} rows={data.fees.map((row) => [unitNumber.get(row.unidad_id) || "—",row.periodo,fmt(row.monto),row.status,row.fecha_pago || "—"])} />}
    {tab === "historico" && <><h2 style={styles.sectionTitle}>Cuentas históricas recibidas de Antive</h2><Table headers={["Unidad","Cargos","Pagos Antive","Saldo inicial","Estado"]} rows={data.accounts.map((row) => [unitNumber.get(row.unidad_id) || "—",fmt(row.reported_charges),fmt(row.reported_payments),fmt(row.reported_balance),row.review_status])} /><h2 style={styles.sectionTitle}>Pagos históricos registrados</h2><Table headers={["Unidad","Periodo","Importe","Recibido por","Estado"]} rows={data.payments.map((row) => [unitNumber.get(row.unidad_id) || "—",row.reported_period || "—",fmt(row.reported_amount),row.received_by,row.review_status])} /><h2 style={styles.sectionTitle}>Recuperaciones históricas</h2><Table headers={["Unidad","Importe","Estado","Fecha"]} rows={data.recoveries.map((row) => [unitNumber.get(row.unidad_id) || "—",fmt(row.amount),row.status,row.collected_at || "—"])} /></>}
    {tab === "proveedores" && <Table headers={["Categoría","Proveedor","Frecuencia","Estado documental"]} rows={data.providers.map((row) => [row.service_category,row.provider_name || "Por definir",row.frequency || "—",row.documentation_status])} />}
    {tab === "pendientes" && <><h2 style={styles.sectionTitle}>Pendientes de transición</h2><Table headers={["Asunto","Categoría","Estado","Responsabilidad"]} rows={data.transition.map((row) => [row.title,row.category,row.operational_status,row.legal_responsibility_status])} /><h2 style={styles.sectionTitle}>Incidencias</h2><Table headers={["Asunto","Categoría","Prioridad","Estado"]} rows={data.incidents.map((row) => [row.title,row.category || "—",row.priority || "—",row.status])} /></>}
  </main>;
}

function Table({ headers, rows }) {
  return <section style={styles.tableWrap}><table style={styles.table}><thead><tr>{headers.map((head) => <th key={head} style={styles.th}>{head}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row,index) => <tr key={index}>{row.map((cell,cellIndex) => <td key={cellIndex} style={styles.td}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length} style={styles.empty}>Sin registros disponibles.</td></tr>}</tbody></table></section>;
}

const styles = {
  page:{minHeight:"100vh",background:"#f6f7f9",fontFamily:"system-ui,sans-serif",padding:"28px 20px 60px",color:"#1f2937"},center:{minHeight:"100vh",display:"grid",placeItems:"center",background:"#f6f7f9",fontFamily:"system-ui,sans-serif",padding:20,color:"#6b7280"},login:{width:"100%",maxWidth:410,background:"#fff",borderRadius:18,padding:30,boxShadow:"0 8px 30px rgba(0,0,0,.08)"},header:{maxWidth:1100,margin:"0 auto 20px",display:"flex",justifyContent:"space-between",gap:20,alignItems:"center"},title:{margin:"0 0 6px",fontSize:26},eyebrow:{margin:"0 0 6px",fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:.6,color:"#6b7280"},muted:{margin:"4px 0",fontSize:13,color:"#6b7280"},label:{display:"block",fontSize:12,fontWeight:700,margin:"20px 0 6px"},input:{width:"100%",boxSizing:"border-box",padding:12,border:"1px solid #d1d5db",borderRadius:9},primary:{width:"100%",marginTop:12,padding:12,border:0,borderRadius:9,background:"#8f1d3f",color:"#fff",fontWeight:800},secondary:{padding:"9px 13px",border:"1px solid #d1d5db",borderRadius:8,background:"#fff",fontWeight:700},notice:{padding:10,background:"#f3f4f6",borderRadius:8,fontSize:13},tabs:{maxWidth:1100,margin:"0 auto 20px",display:"flex",gap:7,overflowX:"auto"},tab:{padding:"9px 12px",border:0,borderRadius:8,background:"#e5e7eb",whiteSpace:"nowrap"},activeTab:{padding:"9px 12px",border:0,borderRadius:8,background:"#1f2937",color:"#fff",whiteSpace:"nowrap"},grid:{maxWidth:1100,margin:"0 auto",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12},card:{background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,padding:16},metric:{fontSize:22},tableWrap:{maxWidth:1100,margin:"0 auto 18px",overflowX:"auto",background:"#fff",border:"1px solid #e5e7eb",borderRadius:12},table:{width:"100%",borderCollapse:"collapse",fontSize:13},th:{padding:"11px 13px",textAlign:"left",background:"#f9fafb",borderBottom:"1px solid #e5e7eb",whiteSpace:"nowrap"},td:{padding:"11px 13px",borderBottom:"1px solid #f3f4f6"},empty:{padding:24,textAlign:"center",color:"#6b7280"},sectionTitle:{maxWidth:1100,margin:"24px auto 10px",fontSize:16},
};
