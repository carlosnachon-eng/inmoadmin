import { useEffect, useState } from "react";
import Layout, { brand } from "../components/Layout";
import { supabase } from "../lib/supabase";
import { usePermiso, SinAcceso } from "../lib/permisos";

const money = (n) => new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", maximumFractionDigits: 0
}).format(Number(n) || 0);

const Card = ({ label, value, detail }) => (
  <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:14, padding:18 }}>
    <p style={{ margin:"0 0 8px", fontSize:10, fontWeight:900, color:"#6b7280", textTransform:"uppercase", letterSpacing:.7 }}>{label}</p>
    <p style={{ margin:0, fontSize:26, fontWeight:900, color:brand.gray }}>{value}</p>
    {detail && <p style={{ margin:"8px 0 0", fontSize:11, color:"#9ca3af", lineHeight:1.4 }}>{detail}</p>}
  </div>
);

const Section = ({ title, subtitle, children }) => (
  <section style={{ marginBottom:28 }}>
    <div style={{ marginBottom:12 }}>
      <h2 style={{ margin:0, fontSize:18, color:brand.gray }}>{title}</h2>
      {subtitle && <p style={{ margin:"4px 0 0", fontSize:12, color:"#9ca3af" }}>{subtitle}</p>}
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:12 }}>{children}</div>
  </section>
);

export default function Consultoria() {
  const { cargando, puedeVer, perfil } = usePermiso("consultoria");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (cargando || !puedeVer) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        if (alive) { setError("Sesión no disponible"); setLoading(false); }
        return;
      }
      try {
        const r = await fetch("/api/consultoria/resumen", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "No fue posible cargar el resumen");
        if (alive) setData(body);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [cargando, puedeVer]);

  if (cargando) return null;
  if (!puedeVer) return <SinAcceso />;

  return (
    <Layout view="consultoria" profile={perfil}>
      <div style={{ padding:"28px", maxWidth:1200, margin:"0 auto" }}>
        <div style={{ marginBottom:26 }}>
          <p style={{ margin:"0 0 4px", fontSize:11, fontWeight:900, color:"#7c3aed", textTransform:"uppercase", letterSpacing:1 }}>Solo lectura</p>
          <h1 style={{ margin:0, fontSize:28, color:brand.gray }}>Consultoría de Negocio</h1>
          <p style={{ margin:"8px 0 0", fontSize:13, color:"#6b7280", maxWidth:760 }}>
            Vista ejecutiva agregada de la operación de Emporio. No permite editar registros ni consultar expedientes, documentos o datos personales.
          </p>
        </div>

        {loading && <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:14, padding:28, color:"#9ca3af" }}>Cargando indicadores...</div>}
        {error && <div style={{ background:"#fef2f2", border:"1px solid #fecaca", color:"#991b1b", borderRadius:12, padding:14 }}>{error}</div>}

        {data && <>
          <Section title="Cartera y administración" subtitle="Tamaño y vigencia de la cartera administrada">
            <Card label="Propiedades registradas" value={data.portfolio.properties_total} />
            <Card label="En administración" value={data.portfolio.properties_administered} />
            <Card label="Ocupadas" value={data.portfolio.properties_occupied} />
            <Card label="Contratos activos" value={data.portfolio.active_contracts} />
            <Card label="Renta mensual activa" value={money(data.portfolio.monthly_rent_active)} />
            <Card label="Vencen en 30 días" value={data.portfolio.contracts_expiring_30d} />
          </Section>

          <Section title="Cobranza" subtitle="Indicadores agregados; sin nombres ni expedientes">
            <Card label="Cobros atrasados" value={data.collections.overdue_count} detail={money(data.collections.overdue_amount)} />
            <Card label="Cobros pendientes" value={data.collections.pending_count} detail={money(data.collections.pending_amount)} />
            <Card label="Pagos últimos 30 días" value={data.collections.paid_last_30d_count} />
            <Card label="Efectividad 30 días" value={data.collections.collection_rate_30d == null ? "—" : `${data.collections.collection_rate_30d}%`} />
          </Section>

          <Section title="Comercial" subtitle="Cierres y comisiones del mes">
            <Card label="Cierres del mes" value={data.commercial.closings_month} />
            <Card label="Comisión generada mes" value={money(data.commercial.commissions_month)} />
            <Card label="Comisión pendiente" value={money(data.commercial.pending_commissions)} />
          </Section>

          <Section title="Operación y jurídico" subtitle="Carga operativa abierta">
            <Card label="Mantenimientos abiertos" value={data.maintenance.open_count} />
            <Card label="Mantenimientos urgentes" value={data.maintenance.urgent_count} />
            <Card label="Solicitudes de póliza abiertas" value={data.legal.open_policy_requests} />
            <Card label="Solicitudes de póliza del mes" value={data.legal.policy_requests_month} />
          </Section>
        </>}
      </div>
    </Layout>
  );
}
