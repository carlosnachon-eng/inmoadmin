import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabase";
import { PageHeader, Btn } from "../../components/Layout";
import { usePermiso, SinAcceso } from "../../lib/permisos";
import {
  CATEGORIAS_FOTO,
  ESTADOS_INSPECCION,
  ESTADOS_RESPUESTA,
  fmtFecha,
  fmtMoney,
  generarPDFInspeccion,
  subirArchivoInspeccion,
  subirDataUrlInspeccion,
} from "../../lib/inspecciones";

const card = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 8px 24px rgba(15,23,42,.06)" };
const input = { width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 14, boxSizing: "border-box", background: "#fff" };
const steps = ["Datos", "Checklist", "Medidores", "Llaves", "Fotos", "Observaciones", "Firmas", "Cerrar"];

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 900, color: "#6b7280", textTransform: "uppercase", letterSpacing: .6, marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

function SignaturePad({ label, onSave, disabled }) {
  const ref = useRef(null);
  const drawing = useRef(false);

  const point = (e) => {
    const canvas = ref.current;
    const rect = canvas.getBoundingClientRect();
    const p = e.touches?.[0] || e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  };

  const start = (e) => {
    if (disabled) return;
    e.preventDefault();
    const ctx = ref.current.getContext("2d");
    const p = point(e);
    drawing.current = true;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!drawing.current || disabled) return;
    e.preventDefault();
    const ctx = ref.current.getContext("2d");
    const p = point(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const stop = () => { drawing.current = false; };
  const clear = () => ref.current.getContext("2d").clearRect(0, 0, ref.current.width, ref.current.height);
  const save = () => onSave(ref.current.toDataURL("image/png"));

  return (
    <div style={{ ...card, padding: 14 }}>
      <p style={{ margin: "0 0 8px", fontWeight: 900, color: "#111827" }}>{label}</p>
      <canvas
        ref={ref}
        width={520}
        height={170}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={stop}
        onMouseLeave={stop}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={stop}
        style={{ width: "100%", height: 170, border: "1px dashed #cbd5e1", borderRadius: 12, background: "#fff", touchAction: "none" }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button disabled={disabled} onClick={clear} style={{ border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}>Limpiar</button>
        <Btn disabled={disabled} small onClick={save}>Guardar firma</Btn>
      </div>
    </div>
  );
}

export default function InspeccionDetalle() {
  const router = useRouter();
  const { id } = router.query;
  const { cargando: permisoCargando, puedeVer, puedeEditar, perfil } = usePermiso("inspecciones");
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [inspeccion, setInspeccion] = useState(null);
  const [inmueble, setInmueble] = useState(null);
  const [contrato, setContrato] = useState(null);
  const [secciones, setSecciones] = useState([]);
  const [elementos, setElementos] = useState([]);
  const [respuestas, setRespuestas] = useState([]);
  const [fotografias, setFotografias] = useState([]);
  const [medidores, setMedidores] = useState([]);
  const [inventario, setInventario] = useState([]);
  const [medidorForm, setMedidorForm] = useState({ tipo: "luz", numero_medidor: "", lectura: "", observaciones: "", foto: null });
  const [inventarioForm, setInventarioForm] = useState({ concepto: "", cantidad: 1, observaciones: "" });
  const [fotoGeneral, setFotoGeneral] = useState({ categoria: "otros", descripcion: "", file: null });

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session && id) loadAll(); }, [session, id]);

  async function loadAll() {
    setLoading(true);
    const { data: ins, error } = await supabase.from("inspecciones").select("*").eq("id", id).single();
    if (error) { showToast(error.message, false); setLoading(false); return; }
    setInspeccion(ins);

    const [prop, cont, sec, elem, resp, fotos, meds, inv] = await Promise.all([
      ins.inmueble_id ? supabase.from("properties").select("*").eq("id", ins.inmueble_id).maybeSingle() : Promise.resolve({ data: null }),
      ins.contrato_id ? supabase.from("contracts").select("*").eq("id", ins.contrato_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("plantilla_inspeccion_secciones").select("*").eq("plantilla_id", ins.plantilla_id).order("orden"),
      supabase.from("plantilla_inspeccion_elementos").select("*").order("orden"),
      supabase.from("inspeccion_respuestas").select("*").eq("inspeccion_id", id),
      supabase.from("inspeccion_fotografias").select("*").eq("inspeccion_id", id).order("created_at", { ascending: false }),
      supabase.from("inspeccion_medidores").select("*").eq("inspeccion_id", id).order("created_at"),
      supabase.from("inspeccion_inventario").select("*").eq("inspeccion_id", id).order("created_at"),
    ]);
    const seccionesData = sec.data || [];
    setInmueble(prop.data || null);
    setContrato(cont.data || null);
    setSecciones(seccionesData);
    setElementos((elem.data || []).filter((e) => seccionesData.some((s) => s.id === e.seccion_id)));
    setRespuestas(resp.data || []);
    setFotografias(fotos.data || []);
    setMedidores(meds.data || []);
    setInventario(inv.data || []);
    setLoading(false);
  }

  const cerrada = inspeccion?.estatus === "cerrada";
  const editable = puedeEditar && !cerrada;

  async function updateInspeccion(fields) {
    const { error } = await supabase.from("inspecciones").update({ ...fields, updated_by: session.user.id }).eq("id", id);
    if (error) showToast(error.message, false);
    else setInspeccion((i) => ({ ...i, ...fields }));
  }

  function respuestaDe(elementoId) {
    return respuestas.find((r) => r.elemento_id === elementoId) || {
      inspeccion_id: id,
      elemento_id: elementoId,
      estado: "sin_observaciones",
      observacion: "",
      prioridad: null,
      responsable: null,
      costo_estimado: "",
    };
  }

  async function guardarRespuesta(elementoId, patch) {
    if (!editable) return;
    const current = respuestaDe(elementoId);
    const payload = { ...current, ...patch, inspeccion_id: id, elemento_id: elementoId };
    if (payload.costo_estimado === "") payload.costo_estimado = null;
    const { data, error } = await supabase
      .from("inspeccion_respuestas")
      .upsert(payload, { onConflict: "inspeccion_id,elemento_id" })
      .select()
      .single();
    if (error) { showToast(error.message, false); return; }
    setRespuestas((arr) => [...arr.filter((r) => r.elemento_id !== elementoId), data]);
    if (payload.estado === "requiere_reparacion") updateInspeccion({ estatus: "con_observaciones" });
  }

  async function subirFotoRespuesta(elementoId, file) {
    if (!editable || !file) return;
    setSaving(true);
    try {
      let respuesta = respuestaDe(elementoId);
      if (!respuesta.id) {
        const { data } = await supabase.from("inspeccion_respuestas").upsert(respuesta, { onConflict: "inspeccion_id,elemento_id" }).select().single();
        respuesta = data;
        setRespuestas((arr) => [...arr.filter((r) => r.elemento_id !== elementoId), data]);
      }
      const url = await subirArchivoInspeccion(id, file, "fotos-checklist");
      const { error } = await supabase.from("inspeccion_fotografias").insert({ inspeccion_id: id, respuesta_id: respuesta.id, categoria: "danos", url });
      if (error) throw error;
      showToast("Foto agregada");
      loadAll();
    } catch (e) { showToast(e.message, false); }
    setSaving(false);
  }

  async function agregarMedidor() {
    if (!editable) return;
    if (!medidorForm.lectura && !medidorForm.numero_medidor) { showToast("Captura lectura o número de medidor", false); return; }
    setSaving(true);
    try {
      let foto_url = null;
      if (medidorForm.foto) foto_url = await subirArchivoInspeccion(id, medidorForm.foto, "medidores");
      const { error } = await supabase.from("inspeccion_medidores").insert({ inspeccion_id: id, ...medidorForm, foto: undefined, foto_url });
      if (error) throw error;
      setMedidorForm({ tipo: "luz", numero_medidor: "", lectura: "", observaciones: "", foto: null });
      showToast("Medidor agregado");
      loadAll();
    } catch (e) { showToast(e.message, false); }
    setSaving(false);
  }

  async function agregarInventario() {
    if (!editable) return;
    if (!inventarioForm.concepto.trim()) { showToast("Captura concepto", false); return; }
    const { error } = await supabase.from("inspeccion_inventario").insert({ inspeccion_id: id, ...inventarioForm, cantidad: Number(inventarioForm.cantidad || 1) });
    if (error) showToast(error.message, false);
    else {
      setInventarioForm({ concepto: "", cantidad: 1, observaciones: "" });
      showToast("Inventario agregado");
      loadAll();
    }
  }

  async function subirFotoGeneral() {
    if (!editable || !fotoGeneral.file) return;
    setSaving(true);
    try {
      const url = await subirArchivoInspeccion(id, fotoGeneral.file, "fotos-generales");
      const { error } = await supabase.from("inspeccion_fotografias").insert({
        inspeccion_id: id,
        categoria: fotoGeneral.categoria,
        descripcion: fotoGeneral.descripcion || null,
        url,
      });
      if (error) throw error;
      setFotoGeneral({ categoria: "otros", descripcion: "", file: null });
      showToast("Foto general agregada");
      loadAll();
    } catch (e) { showToast(e.message, false); }
    setSaving(false);
  }

  async function guardarFirma(campo, dataUrl) {
    if (!editable) return;
    setSaving(true);
    try {
      const url = await subirDataUrlInspeccion(id, dataUrl, "firmas", `${campo}.png`);
      await updateInspeccion({ [campo]: url });
      showToast("Firma guardada");
    } catch (e) { showToast(e.message, false); }
    setSaving(false);
  }

  function validarCierre() {
    const errores = [];
    elementos.forEach((elemento) => {
      const r = respuestas.find((item) => item.elemento_id === elemento.id);
      if (r?.estado === "requiere_reparacion") {
        const fotos = fotografias.filter((f) => f.respuesta_id === r.id);
        if (!r.observacion?.trim()) errores.push(`${elemento.nombre}: falta observación`);
        if (!fotos.length) errores.push(`${elemento.nombre}: falta foto`);
      }
    });
    if (!inspeccion?.firma_inquilino_url) errores.push("Falta firma de quien entrega/recibe");
    if (!inspeccion?.firma_representante_url) errores.push("Falta firma del representante de Emporio");
    return errores;
  }

  async function generarYSubirPdf() {
    const doc = await generarPDFInspeccion({ inspeccion, inmueble, contrato, secciones, elementos, respuestas, fotografias, medidores, inventario });
    const blob = doc.output("blob");
    const file = new File([blob], `inspeccion-${id}.pdf`, { type: "application/pdf" });
    const url = await subirArchivoInspeccion(id, file, "pdf");
    await updateInspeccion({ pdf_url: url });
    return url;
  }

  async function cerrarInspeccion() {
    const errores = validarCierre();
    if (errores.length) {
      showToast(`No se puede cerrar: ${errores.slice(0, 3).join(" · ")}`, false);
      return;
    }
    setSaving(true);
    try {
      const pdf_url = inspeccion.pdf_url || await generarYSubirPdf();
      await supabase.from("inspecciones").update({
        estatus: "cerrada",
        cerrada_por: session.user.id,
        cerrada_en: new Date().toISOString(),
        pdf_url,
        updated_by: session.user.id,
      }).eq("id", id);
      showToast("Inspección cerrada");
      loadAll();
    } catch (e) { showToast(e.message, false); }
    setSaving(false);
  }

  if (authLoading || permisoCargando || loading) return <div style={{ padding: 40, fontFamily: "system-ui" }}>Cargando inspección...</div>;
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }
  if (!puedeVer) return <SinAcceso />;
  if (!inspeccion) return null;

  const st = ESTADOS_INSPECCION[inspeccion.estatus] || ESTADOS_INSPECCION.borrador;
  const progreso = Math.round(((step + 1) / steps.length) * 100);
  const fotosGenerales = fotografias.filter((f) => !f.respuesta_id);

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>
      <PageHeader title="Inspección de entrega-recepción" icon="🔎" actions={<Btn variant="secondary" onClick={() => router.push("/inspecciones")}>← Volver</Btn>} />
      {toast && <div style={{ position: "fixed", right: 18, top: 18, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 16px", borderRadius: 12, zIndex: 1200, fontWeight: 800, maxWidth: 420 }}>{toast.msg}</div>}

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: 22 }}>
        <section style={{ ...card, padding: 20, marginBottom: 16, borderTop: `5px solid ${st.color}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: "0 0 5px", color: "#9ca3af", fontSize: 12, textTransform: "uppercase", fontWeight: 900 }}>Entrega-recepción · {fmtFecha(inspeccion.fecha)}</p>
              <h1 style={{ margin: 0, color: "#111827", fontSize: 24 }}>{inmueble?.name || contrato?.property_name || "Inmueble"}</h1>
              <p style={{ margin: "6px 0 0", color: "#6b7280" }}>Entrega: {inspeccion.entregado_por || "—"} · Recibe: {inspeccion.recibido_por || "—"}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ background: st.bg, color: st.color, padding: "7px 12px", borderRadius: 999, fontWeight: 900, fontSize: 13 }}>{st.label}</span>
              {inspeccion.pdf_url && <p><a href={inspeccion.pdf_url} target="_blank" rel="noreferrer" style={{ color: "#b91c3c", fontWeight: 900 }}>Ver PDF</a></p>}
            </div>
          </div>
          <div style={{ marginTop: 18, background: "#e5e7eb", height: 8, borderRadius: 99 }}>
            <div style={{ width: `${progreso}%`, height: 8, background: "#b91c3c", borderRadius: 99 }} />
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 14 }}>
            {steps.map((s, idx) => (
              <button key={s} onClick={() => setStep(idx)} style={{ border: "none", borderRadius: 999, padding: "7px 11px", cursor: "pointer", background: step === idx ? "#b91c3c" : "#fff1f2", color: step === idx ? "#fff" : "#b91c3c", fontWeight: 900, fontSize: 12 }}>{idx + 1}. {s}</button>
            ))}
          </div>
        </section>

        {step === 0 && (
          <section style={{ ...card, padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Fecha"><input disabled={!editable} type="date" value={inspeccion.fecha || ""} onChange={(e) => updateInspeccion({ fecha: e.target.value })} style={input} /></Field>
              <Field label="Hora"><input disabled={!editable} type="time" value={inspeccion.hora?.slice(0, 5) || ""} onChange={(e) => updateInspeccion({ hora: `${e.target.value}:00` })} style={input} /></Field>
              <Field label="Entregado por"><input disabled={!editable} value={inspeccion.entregado_por || ""} onChange={(e) => setInspeccion({ ...inspeccion, entregado_por: e.target.value })} onBlur={(e) => updateInspeccion({ entregado_por: e.target.value })} style={input} /></Field>
              <Field label="Recibido por"><input disabled={!editable} value={inspeccion.recibido_por || ""} onChange={(e) => setInspeccion({ ...inspeccion, recibido_por: e.target.value })} onBlur={(e) => updateInspeccion({ recibido_por: e.target.value })} style={input} /></Field>
            </div>
          </section>
        )}

        {step === 1 && (
          <section style={{ display: "grid", gap: 14 }}>
            {secciones.map((seccion) => (
              <div key={seccion.id} style={{ ...card, padding: 18 }}>
                <h2 style={{ margin: "0 0 14px", color: "#111827", fontSize: 18 }}>{seccion.nombre}</h2>
                {elementos.filter((e) => e.seccion_id === seccion.id).map((elemento) => {
                  const r = respuestaDe(elemento.id);
                  const fotos = fotografias.filter((f) => f.respuesta_id === r.id);
                  return (
                    <div key={elemento.id} style={{ borderTop: "1px solid #f1f5f9", padding: "14px 0" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1.4fr) minmax(180px,1fr)", gap: 12 }}>
                        <div>
                          <p style={{ margin: 0, fontWeight: 900, color: "#111827" }}>{elemento.nombre}</p>
                          <p style={{ margin: "4px 0 0", color: "#9ca3af", fontSize: 12 }}>{elemento.requiere_foto ? "Foto sugerida" : "Foto opcional"} · {fotos.length} foto(s)</p>
                        </div>
                        <select disabled={!editable} value={r.estado} onChange={(e) => guardarRespuesta(elemento.id, { estado: e.target.value })} style={input}>
                          {ESTADOS_RESPUESTA.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                        </select>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 150px 170px 140px", gap: 10, marginTop: 10 }}>
                        <input disabled={!editable} value={r.observacion || ""} onChange={(e) => guardarRespuesta(elemento.id, { observacion: e.target.value })} placeholder="Observación" style={input} />
                        <select disabled={!editable} value={r.prioridad || ""} onChange={(e) => guardarRespuesta(elemento.id, { prioridad: e.target.value || null })} style={input}>
                          <option value="">Prioridad</option><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option>
                        </select>
                        <select disabled={!editable} value={r.responsable || ""} onChange={(e) => guardarRespuesta(elemento.id, { responsable: e.target.value || null })} style={input}>
                          <option value="">Responsable</option><option value="emporio">Emporio</option><option value="propietario">Propietario</option><option value="inquilino">Inquilino</option><option value="pendiente_definir">Pendiente definir</option>
                        </select>
                        <input disabled={!editable} type="number" value={r.costo_estimado || ""} onChange={(e) => guardarRespuesta(elemento.id, { costo_estimado: e.target.value })} placeholder="$ estimado" style={input} />
                      </div>
                      {editable && <input type="file" accept="image/*" capture="environment" onChange={(e) => subirFotoRespuesta(elemento.id, e.target.files?.[0])} style={{ marginTop: 10 }} />}
                      {fotos.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>{fotos.map((f) => <img key={f.id} src={f.url} alt="" style={{ width: 86, height: 64, objectFit: "cover", borderRadius: 8 }} />)}</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        )}

        {step === 2 && (
          <section style={{ ...card, padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Medidores</h2>
            <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 1fr", gap: 10 }}>
              <select disabled={!editable} value={medidorForm.tipo} onChange={(e) => setMedidorForm({ ...medidorForm, tipo: e.target.value })} style={input}><option value="luz">Luz</option><option value="agua">Agua</option><option value="gas">Gas</option><option value="otro">Otro</option></select>
              <input disabled={!editable} value={medidorForm.numero_medidor} onChange={(e) => setMedidorForm({ ...medidorForm, numero_medidor: e.target.value })} placeholder="Número de medidor" style={input} />
              <input disabled={!editable} value={medidorForm.lectura} onChange={(e) => setMedidorForm({ ...medidorForm, lectura: e.target.value })} placeholder="Lectura" style={input} />
            </div>
            <textarea disabled={!editable} value={medidorForm.observaciones} onChange={(e) => setMedidorForm({ ...medidorForm, observaciones: e.target.value })} placeholder="Observaciones" style={{ ...input, minHeight: 70, marginTop: 10 }} />
            {editable && <input type="file" accept="image/*" capture="environment" onChange={(e) => setMedidorForm({ ...medidorForm, foto: e.target.files?.[0] })} style={{ marginTop: 10 }} />}
            {editable && <div style={{ marginTop: 12 }}><Btn small disabled={saving} onClick={agregarMedidor}>Agregar medidor</Btn></div>}
            <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
              {medidores.map((m) => <div key={m.id} style={{ background: "#f9fafb", borderRadius: 10, padding: 12 }}><b>{m.tipo.toUpperCase()}</b> · {m.numero_medidor || "s/n"} · lectura {m.lectura || "—"} {m.foto_url && <a href={m.foto_url} target="_blank" rel="noreferrer" style={{ marginLeft: 8, color: "#b91c3c" }}>foto</a>}</div>)}
            </div>
          </section>
        )}

        {step === 3 && (
          <section style={{ ...card, padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Llaves, controles y accesorios</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 10 }}>
              <input disabled={!editable} value={inventarioForm.concepto} onChange={(e) => setInventarioForm({ ...inventarioForm, concepto: e.target.value })} placeholder="Ej. Llave principal, control portón, tarjeta de acceso" style={input} />
              <input disabled={!editable} type="number" value={inventarioForm.cantidad} onChange={(e) => setInventarioForm({ ...inventarioForm, cantidad: e.target.value })} style={input} />
            </div>
            <input disabled={!editable} value={inventarioForm.observaciones} onChange={(e) => setInventarioForm({ ...inventarioForm, observaciones: e.target.value })} placeholder="Observaciones" style={{ ...input, marginTop: 10 }} />
            {editable && <div style={{ marginTop: 12 }}><Btn small onClick={agregarInventario}>Agregar</Btn></div>}
            <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
              {inventario.map((i) => <div key={i.id} style={{ background: "#f9fafb", borderRadius: 10, padding: 12 }}><b>{i.concepto}</b> · {i.cantidad} {i.observaciones && `· ${i.observaciones}`}</div>)}
            </div>
          </section>
        )}

        {step === 4 && (
          <section style={{ ...card, padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Fotografías generales</h2>
            <div style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 10 }}>
              <select disabled={!editable} value={fotoGeneral.categoria} onChange={(e) => setFotoGeneral({ ...fotoGeneral, categoria: e.target.value })} style={input}>{CATEGORIAS_FOTO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input disabled={!editable} value={fotoGeneral.descripcion} onChange={(e) => setFotoGeneral({ ...fotoGeneral, descripcion: e.target.value })} placeholder="Descripción opcional" style={input} />
            </div>
            {editable && <input type="file" accept="image/*" capture="environment" onChange={(e) => setFotoGeneral({ ...fotoGeneral, file: e.target.files?.[0] })} style={{ marginTop: 10 }} />}
            {editable && <div style={{ marginTop: 12 }}><Btn small disabled={saving || !fotoGeneral.file} onClick={subirFotoGeneral}>Subir foto</Btn></div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px,1fr))", gap: 10, marginTop: 16 }}>
              {fotosGenerales.map((f) => <a key={f.id} href={f.url} target="_blank" rel="noreferrer" style={{ color: "#111827", textDecoration: "none" }}><img src={f.url} alt="" style={{ width: "100%", height: 96, objectFit: "cover", borderRadius: 10 }} /><p style={{ margin: "4px 0 0", fontSize: 12 }}>{f.categoria}</p></a>)}
            </div>
          </section>
        )}

        {step === 5 && (
          <section style={{ ...card, padding: 20 }}>
            <Field label="Observaciones generales">
              <textarea disabled={!editable} value={inspeccion.observaciones_generales || ""} onChange={(e) => setInspeccion({ ...inspeccion, observaciones_generales: e.target.value })} onBlur={(e) => updateInspeccion({ observaciones_generales: e.target.value })} style={{ ...input, minHeight: 160 }} />
            </Field>
          </section>
        )}

        {step === 6 && (
          <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              {inspeccion.firma_representante_url && <img src={inspeccion.firma_representante_url} alt="Firma representante" style={{ width: "100%", maxHeight: 120, objectFit: "contain", background: "#fff", borderRadius: 12, marginBottom: 10 }} />}
              <SignaturePad disabled={!editable || saving} label="Firma representante Emporio" onSave={(url) => guardarFirma("firma_representante_url", url)} />
            </div>
            <div>
              {inspeccion.firma_inquilino_url && <img src={inspeccion.firma_inquilino_url} alt="Firma inquilino" style={{ width: "100%", maxHeight: 120, objectFit: "contain", background: "#fff", borderRadius: 12, marginBottom: 10 }} />}
              <SignaturePad disabled={!editable || saving} label="Firma persona que entrega/recibe" onSave={(url) => guardarFirma("firma_inquilino_url", url)} />
            </div>
          </section>
        )}

        {step === 7 && (
          <section style={{ ...card, padding: 22 }}>
            <h2 style={{ marginTop: 0 }}>Generar PDF / cerrar inspección</h2>
            <p style={{ color: "#6b7280", lineHeight: 1.5 }}>Antes de cerrar, el sistema valida que toda reparación tenga observación y fotografía, y que existan ambas firmas.</p>
            <div style={{ background: "#f9fafb", borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <p style={{ margin: 0 }}><b>Respuestas:</b> {respuestas.length}/{elementos.length}</p>
              <p style={{ margin: "6px 0 0" }}><b>Fotos:</b> {fotografias.length}</p>
              <p style={{ margin: "6px 0 0" }}><b>Costos estimados:</b> {fmtMoney(respuestas.reduce((a, r) => a + Number(r.costo_estimado || 0), 0))}</p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn variant="secondary" disabled={saving} onClick={async () => { setSaving(true); try { await generarYSubirPdf(); showToast("PDF generado"); loadAll(); } catch (e) { showToast(e.message, false); } setSaving(false); }}>Generar PDF</Btn>
              {editable && <Btn disabled={saving} onClick={cerrarInspeccion}>Cerrar inspección</Btn>}
            </div>
          </section>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
          <Btn variant="secondary" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>← Anterior</Btn>
          <Btn disabled={step === steps.length - 1} onClick={() => setStep(Math.min(steps.length - 1, step + 1))}>Siguiente →</Btn>
        </div>
      </main>

      <style jsx>{`
        @media (max-width: 760px) {
          main { padding: 12px !important; }
          section, div[style*="grid-template-columns"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
