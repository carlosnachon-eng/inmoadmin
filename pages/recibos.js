import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";
import { PageHeader, brand } from "../components/Layout";
import { usePermiso, SinAcceso } from "../lib/permisos";
import jsPDF from "jspdf";
import { FIRMA_CARLOS_B64 } from "../lib/firmaCarlos";

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0 }).format(n || 0);

const ESTATUS_STYLE = {
  activo:              { bg: "#d1fae5", color: "#065f46", label: "Activo" },
  solicitud_recibida:  { bg: "#dbeafe", color: "#1e40af", label: "Solicitud recibida" },
  vencido:             { bg: "#fef3c7", color: "#92400e", label: "Vencido" },
  cancelado:           { bg: "#fee2e2", color: "#991b1b", label: "Cancelado" },
  concretado:          { bg: "#dbeafe", color: "#1e40af", label: "Concretado" },
};

const Modal = ({ title, onClose, children }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{title}</h2>
        <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

export default function Recibos() {
  const router = useRouter();
  const { cargando: permisoCargando, puedeVer } = usePermiso("recibos");
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [recibos, setRecibos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroEstatus, setFiltroEstatus] = useState("activo");
  const [modalCancelar, setModalCancelar] = useState(null);
  const [motivoCancelacion, setMotivoCancelacion] = useState("");
  const [modalSolicitud, setModalSolicitud] = useState(null);
  const [fechaLimiraFirma, setFechaLimiteFirma] = useState("");
  const [modalAbono, setModalAbono] = useState(null);
  const [formAbono, setFormAbono] = useState({
    monto: "", fecha: new Date().toISOString().split("T")[0],
    forma_pago: "Transferencia", recibido_por: "Guillermo",
    comprobante: null, notas: "",
  });
  const [saving, setSaving] = useState(false);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) loadProfile(s.user.id);
      else { setProfile(null); setAuthLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (uid) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
    setProfile(data); setAuthLoading(false);
  };

  const loadRecibos = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("recibos_apartado")
      .select("*, recibos_abonos(*)")
      .order("created_at", { ascending: false });
    setRecibos(data || []);
    setLoading(false);
  };

  useEffect(() => { if (session) loadRecibos(); }, [session]);

  // Carlos es el único que puede reactivar vencidos
  const esCarlos = profile?.role_id === "admin" || profile?.email === "carlos.nachon@emporioinmobiliario.mx";
  const puedeIniciarFlujo = ["admin", "gerente_ventas"].includes(profile?.role_id);
  const puedeRegistrarAbono = ["admin", "gerente_ventas"].includes(profile?.role_id);

  const resumenPago = (recibo) => {
    const abonos = recibo.recibos_abonos || [];
    const totalAbonos = abonos.reduce((sum, abono) => sum + Number(abono.monto || 0), 0);
    const totalRecibido = Number(recibo.monto || 0) + totalAbonos;
    const totalAcordado = Number(recibo.monto_total_acordado || recibo.monto || 0);
    return {
      totalAbonos,
      totalRecibido,
      totalAcordado,
      saldo: Math.max(0, totalAcordado - totalRecibido),
    };
  };

  const filtered = recibos.filter(r => {
    const matchSearch = !search ||
      r.folio?.toLowerCase().includes(search.toLowerCase()) ||
      r.cliente_nombre?.toLowerCase().includes(search.toLowerCase()) ||
      r.inmueble?.toLowerCase().includes(search.toLowerCase());
    const matchTipo = !filtroTipo || r.tipo === filtroTipo;
    const matchEstatus = !filtroEstatus || r.estatus === filtroEstatus;
    return matchSearch && matchTipo && matchEstatus;
  });

  // ── Cancelar ──────────────────────────────────────────────
  const cambiarEstatus = async (recibo, nuevoEstatus) => {
    if (nuevoEstatus === "concretado" && !esCarlos) {
      showToast("Solo Admin puede confirmar que la operación se concretó", false);
      return;
    }
    if (nuevoEstatus === "cancelado") {
      setModalCancelar(recibo);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("recibos_apartado").update({ estatus: nuevoEstatus }).eq("id", recibo.id);
    setSaving(false);
    if (error) { showToast("Error al actualizar", false); return; }
    await supabase.from("recibos_log").insert({ recibo_id: recibo.id, accion: nuevoEstatus, usuario_id: session.user.id });
    showToast("Estatus actualizado");
    loadRecibos();
  };

  const confirmarCancelacion = async () => {
    if (!motivoCancelacion.trim()) { showToast("Escribe el motivo de cancelación", false); return; }
    setSaving(true);
    const { error } = await supabase.from("recibos_apartado").update({
      estatus: "cancelado",
      motivo_cancelacion: motivoCancelacion,
      cancelado_por: session.user.id,
      cancelado_at: new Date().toISOString(),
    }).eq("id", modalCancelar.id);
    if (!error) {
      await supabase.from("recibos_log").insert({ recibo_id: modalCancelar.id, accion: "cancelado", usuario_id: session.user.id });
      await fetch("/api/notificar-cancelacion-recibo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folio: modalCancelar.folio,
          cliente: modalCancelar.cliente_nombre,
          inmueble: modalCancelar.inmueble,
          monto: modalCancelar.monto,
          motivo: motivoCancelacion,
          cancelado_por: profile?.email,
        }),
      });
    }
    setSaving(false);
    setModalCancelar(null);
    setMotivoCancelacion("");
    if (error) { showToast("Error al cancelar", false); return; }
    showToast("Recibo cancelado");
    loadRecibos();
  };

  const reintentarFlujo = async (recibo) => {
    setSaving(true);
    try {
      const res = await fetch("/api/recibos/trigger-firmas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ recibo_id: recibo.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo completar el flujo");
      showToast("Propiedad reservada y expediente de Firmas confirmado");
      loadRecibos();
    } catch (error) {
      showToast(error.message, false);
    }
    setSaving(false);
  };

  // ── Solicitud recibida ────────────────────────────────────
  const confirmarSolicitudRecibida = async () => {
    if (!fechaLimiraFirma) { showToast("Selecciona la fecha límite de firma", false); return; }
    setSaving(true);
    const { error } = await supabase.from("recibos_apartado").update({
      estatus: "solicitud_recibida",
      fecha_limite_firma: fechaLimiraFirma,
      solicitud_recibida_en: new Date().toISOString(),
      solicitud_recibida_por: profile?.email || session.user.email,
    }).eq("id", modalSolicitud.id);
    if (!error) {
      await supabase.from("recibos_log").insert({
        recibo_id: modalSolicitud.id,
        accion: "solicitud_recibida",
        usuario_id: session.user.id,
        notas: `Fecha límite de firma: ${fechaLimiraFirma}`,
      });
    }
    setSaving(false);
    setModalSolicitud(null);
    setFechaLimiteFirma("");
    if (error) { showToast("Error al actualizar", false); return; }
    showToast("Solicitud marcada como recibida");
    loadRecibos();
  };

  // ── Reactivar (solo Carlos, solo vencidos) ────────────────
  const handleReactivar = async (recibo) => {
    setSaving(true);
    const { error } = await supabase.from("recibos_apartado").update({
      estatus: "activo",
      reactivado_en: new Date().toISOString(),
      reactivado_por: profile?.email || session.user.email,
    }).eq("id", recibo.id);
    if (!error) {
      await supabase.from("recibos_log").insert({
        recibo_id: recibo.id,
        accion: "reactivado",
        usuario_id: session.user.id,
        notas: "Reactivación manual por excepción",
      });
    }
    setSaving(false);
    if (error) { showToast("Error al reactivar", false); return; }
    showToast("Recibo reactivado");
    loadRecibos();
  };

  const handleCorregirConcretado = async (recibo) => {
    if (!esCarlos) return;
    if (!confirm(`¿Regresar ${recibo.folio} a Activo para corregir o cancelar la operación? El historial se conservará.`)) return;
    setSaving(true);
    const { error } = await supabase.from("recibos_apartado").update({
      estatus: "activo",
      reactivado_en: new Date().toISOString(),
      reactivado_por: profile?.email || session.user.email,
    }).eq("id", recibo.id);
    if (!error) {
      await supabase.from("recibos_log").insert({
        recibo_id: recibo.id,
        accion: "correccion_estado_concretado",
        usuario_id: session.user.id,
        notas: "Recibo regresado a Activo por Admin para corrección",
      });
    }
    setSaving(false);
    if (error) { showToast("No se pudo corregir el estado", false); return; }
    showToast("Recibo regresado a Activo");
    loadRecibos();
  };

  const abrirAbono = (recibo) => {
    const { saldo } = resumenPago(recibo);
    setModalAbono(recibo);
    setFormAbono({
      monto: saldo > 0 ? saldo.toString() : "",
      fecha: new Date().toISOString().split("T")[0],
      forma_pago: "Transferencia",
      recibido_por: "Guillermo",
      comprobante: null,
      notas: "",
    });
  };

  const generarPdfAbono = async (recibo, abono, totalRecibido, saldo, folioPersonalizado = null) => {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const W = 612, H = 792, M = 42;
    const RED = [185, 28, 60], DARK = [26, 26, 46], GRAY = [107, 114, 128];
    const LIGHT = [249, 250, 251], GREEN = [6, 95, 70], ORANGE = [194, 65, 12];
    const folioAbono = folioPersonalizado
      || `${recibo.folio}-A${String((recibo.recibos_abonos?.length || 0) + 1).padStart(2, "0")}`;
    const fechaTexto = new Date(`${abono.fecha}T12:00:00`).toLocaleDateString("es-MX", {
      day: "numeric", month: "long", year: "numeric"
    });

    doc.setFillColor(...RED);
    doc.rect(0, 0, W, 6, "F");

    try {
      const res = await fetch("https://www.emporioinmobiliario.com.mx/logo.png");
      const blob = await res.blob();
      const logo = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      doc.addImage(logo, "PNG", M, 14, 105, 56);
    } catch (_) {}

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...DARK);
    doc.text("RECIBO COMPLEMENTARIO", 165, 38);
    doc.setFontSize(10);
    doc.setTextColor(...RED);
    doc.text(recibo.tipo === "compraventa" ? "COMPRAVENTA" : "ARRENDAMIENTO", 165, 54);
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(`Fecha: ${fechaTexto}`, W - M, 30, { align: "right" });
    doc.text(`Folio: ${folioAbono}`, W - M, 44, { align: "right" });
    doc.text(`Recibo original: ${recibo.folio}`, W - M, 58, { align: "right" });
    doc.setDrawColor(...RED);
    doc.setLineWidth(2);
    doc.line(M, 82, W - M, 82);

    let y = 102;
    doc.setFillColor(253, 240, 241);
    doc.roundedRect(M, y, W - (M * 2), 82, 6, 6, "F");
    doc.setFillColor(...RED);
    doc.rect(M, y, 5, 82, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text("RECIBÍ DE", M + 18, y + 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...DARK);
    doc.text(recibo.cliente_nombre || "—", M + 18, y + 38);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text("LA CANTIDAD DE", M + 310, y + 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...RED);
    doc.text(fmt(abono.monto), M + 310, y + 43);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    doc.text(`Pago: ${abono.forma_pago} · Recibido por: ${abono.recibido_por}`, M + 18, y + 64);

    y += 104;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...RED);
    doc.text("INMUEBLE Y CONCEPTO", M, y);
    y += 14;
    doc.setFillColor(...LIGHT);
    doc.roundedRect(M, y, W - (M * 2), 66, 5, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...DARK);
    doc.text("Abono complementario al recibo de apartado", M + 14, y + 20);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text(doc.splitTextToSize(recibo.inmueble || "—", W - (M * 2) - 28), M + 14, y + 38);

    y += 88;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...RED);
    doc.text("RESUMEN DEL APARTADO", M, y);
    y += 14;
    const cards = [
      { label: "TOTAL ACORDADO", value: fmt(recibo.monto_total_acordado || recibo.monto), color: DARK },
      { label: "TOTAL RECIBIDO", value: fmt(totalRecibido), color: GREEN },
      { label: "SALDO PENDIENTE", value: fmt(saldo), color: saldo > 0 ? ORANGE : GREEN },
    ];
    const cardW = (W - (M * 2) - 20) / 3;
    cards.forEach((card, index) => {
      const x = M + index * (cardW + 10);
      doc.setFillColor(...LIGHT);
      doc.roundedRect(x, y, cardW, 62, 5, 5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...GRAY);
      doc.text(card.label, x + 10, y + 18);
      doc.setFontSize(14);
      doc.setTextColor(...card.color);
      doc.text(card.value, x + 10, y + 42);
    });
    y += 82;

    if (abono.notas) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...GRAY);
      doc.text("NOTAS", M, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...DARK);
      doc.text(doc.splitTextToSize(abono.notas, W - (M * 2)), M, y + 16);
      y += 46;
    }

    y = Math.max(y + 20, 480);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...RED);
    doc.text("Por Emporio Inmobiliario", M, y);
    try {
      doc.addImage(FIRMA_CARLOS_B64, "PNG", M, y + 4, 95, 50);
    } catch (_) {}
    doc.setDrawColor(180, 180, 180);
    doc.line(M, y + 58, M + 190, y + 58);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    doc.text("Carlos Alejandro Nachón Saldivar", M, y + 70);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(`Recibido por: ${abono.recibido_por}`, M, y + 81);

    const clientX = 330;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    doc.text(recibo.tipo === "compraventa" ? "Nombre y firma del comprador" : "Nombre y firma del cliente", clientX, y);
    doc.line(clientX, y + 58, W - M, y + 58);
    doc.text(recibo.cliente_nombre || "Cliente", clientX, y + 70);

    try {
      const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(`https://www.emporioinmobiliario.com.mx/verificar/${recibo.folio}`)}&size=90&margin=1`;
      const qrRes = await fetch(qrUrl);
      const qrBlob = await qrRes.blob();
      const qrB64 = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(qrBlob);
      });
      doc.addImage(qrB64, "PNG", W - M - 58, H - 94, 58, 58);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(...GRAY);
      doc.text("Verificar recibo", W - M - 29, H - 31, { align: "center" });
    } catch (_) {}

    doc.setFillColor(...RED);
    doc.rect(0, H - 6, W, 6, "F");
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text("Este documento complementa el recibo de apartado original y no lo sustituye.", W / 2, H - 22, { align: "center" });
    doc.setFontSize(6.5);
    doc.text("Emporio Inmobiliario · emporioinmobiliario.com.mx", W / 2, H - 11, { align: "center" });
    return { doc, folioAbono };
  };

  const regenerarPdfAbono = async (recibo, abono) => {
    if (!esCarlos) return;
    setSaving(true);
    try {
      const abonosOrdenados = [...(recibo.recibos_abonos || [])]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const indice = Math.max(0, abonosOrdenados.findIndex(item => item.id === abono.id));
      const folioAbono = `${recibo.folio}-A${String(indice + 1).padStart(2, "0")}`;
      const totalAbonosHastaEste = abonosOrdenados
        .slice(0, indice + 1)
        .reduce((sum, item) => sum + Number(item.monto || 0), 0);
      const totalAcordado = Number(recibo.monto_total_acordado || recibo.monto || 0);
      const totalRecibido = Number(recibo.monto || 0) + totalAbonosHastaEste;
      const saldo = Math.max(0, totalAcordado - totalRecibido);
      const { doc } = await generarPdfAbono(recibo, abono, totalRecibido, saldo, folioAbono);
      const pdfPath = `${recibo.folio}/abono-${abono.id}.pdf`;
      const { error: pdfError } = await supabase.storage
        .from("recibos-apartado")
        .upload(pdfPath, doc.output("blob"), { contentType: "application/pdf", upsert: true });
      if (pdfError) throw pdfError;
      const { data: signedPdf } = await supabase.storage
        .from("recibos-apartado")
        .createSignedUrl(pdfPath, 60 * 60 * 24 * 365);
      const { error: updateError } = await supabase
        .from("recibos_abonos")
        .update({ pdf_url: signedPdf?.signedUrl || null })
        .eq("id", abono.id);
      if (updateError) throw updateError;
      doc.save(`${folioAbono}.pdf`);
      showToast("PDF complementario regenerado con QR");
      loadRecibos();
    } catch (error) {
      showToast(error.message || "No se pudo regenerar el PDF", false);
    }
    setSaving(false);
  };

  const sincronizarAbonoConCierre = async (abono) => {
    if (!esCarlos) return;
    setSaving(true);
    try {
      const response = await fetch("/api/recibos/sincronizar-abono-cierre", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ abono_id: abono.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo sincronizar");
      showToast(data.pendiente_cierre
        ? "El abono está listo y se integrará cuando crees el cierre"
        : "Abono aplicado en Cierres");
    } catch (error) {
      showToast(error.message || "No se pudo sincronizar el abono", false);
    }
    setSaving(false);
  };

  const guardarAbono = async () => {
    if (!modalAbono || !puedeRegistrarAbono) return;
    const monto = Number(formAbono.monto || 0);
    const resumen = resumenPago(modalAbono);
    if (monto <= 0) { showToast("Captura un monto válido", false); return; }
    if (monto > resumen.saldo && resumen.saldo > 0) {
      showToast(`El abono excede el saldo pendiente de ${fmt(resumen.saldo)}`, false);
      return;
    }
    setSaving(true);
    try {
      const timestamp = Date.now();
      let comprobanteUrl = null;
      if (formAbono.comprobante) {
        const ext = formAbono.comprobante.name.split(".").pop();
        const path = `${modalAbono.folio}/abono-${timestamp}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("recibos-comprobantes")
          .upload(path, formAbono.comprobante, { upsert: false });
        if (uploadError) throw uploadError;
        const { data: signed } = await supabase.storage
          .from("recibos-comprobantes")
          .createSignedUrl(path, 60 * 60 * 24 * 365);
        comprobanteUrl = signed?.signedUrl || null;
      }

      const totalRecibido = resumen.totalRecibido + monto;
      const saldo = Math.max(0, resumen.totalAcordado - totalRecibido);
      const { doc, folioAbono } = await generarPdfAbono(
        modalAbono,
        { ...formAbono, monto },
        totalRecibido,
        saldo
      );
      const pdfPath = `${modalAbono.folio}/abono-${timestamp}.pdf`;
      const { error: pdfError } = await supabase.storage
        .from("recibos-apartado")
        .upload(pdfPath, doc.output("blob"), { contentType: "application/pdf", upsert: false });
      if (pdfError) throw pdfError;
      const { data: signedPdf } = await supabase.storage
        .from("recibos-apartado")
        .createSignedUrl(pdfPath, 60 * 60 * 24 * 365);

      const { data: abonoCreado, error } = await supabase.from("recibos_abonos").insert({
        recibo_id: modalAbono.id,
        monto,
        fecha: formAbono.fecha,
        forma_pago: formAbono.forma_pago,
        recibido_por: formAbono.recibido_por,
        comprobante_url: comprobanteUrl,
        pdf_url: signedPdf?.signedUrl || null,
        notas: formAbono.notas || null,
        created_by: session.user.id,
      }).select("id").single();
      if (error) throw error;
      await supabase.from("recibos_log").insert({
        recibo_id: modalAbono.id,
        accion: "abono_registrado",
        usuario_id: session.user.id,
        notas: `${folioAbono}: ${fmt(monto)}. Saldo: ${fmt(saldo)}`,
      });
      const syncResponse = await fetch("/api/recibos/sincronizar-abono-cierre", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ abono_id: abonoCreado.id }),
      });
      const syncData = await syncResponse.json();
      if (!syncResponse.ok || !syncData.ok) {
        throw new Error(syncData.error || "El abono se guardó, pero no pudo sincronizarse con Cierres");
      }
      doc.save(`${folioAbono}.pdf`);
      setModalAbono(null);
      showToast(syncData.pendiente_cierre
        ? `Abono de ${fmt(monto)} registrado; se integrará al crear el cierre`
        : `Abono de ${fmt(monto)} registrado y aplicado en Cierres`);
      loadRecibos();
    } catch (error) {
      showToast(error.message || "No se pudo registrar el abono", false);
    }
    setSaving(false);
  };

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: brand.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src="https://www.emporioinmobiliario.com.mx/logo.png" alt="Emporio" style={{ height: 48, opacity: 0.4 }} />
    </div>
  );
  if (!session) { if (typeof window !== "undefined") window.location.href = "/"; return null; }

  if (permisoCargando) return null;
  if (!puedeVer) return <SinAcceso />;

  return (
    <div style={{ minHeight: "100vh", background: brand.bg, fontFamily: "system-ui, sans-serif" }}>
      {toast && (
        <div style={{ position: "fixed", top: 24, right: 16, background: toast.ok ? "#065f46" : "#991b1b", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: 320 }}>
          {toast.msg}
        </div>
      )}

      <PageHeader
        title="Recibos de Apartado"
        icon="🧾"
        actions={
          <button onClick={() => router.push("/recibos/nuevo")} style={{ background: brand.red, color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
            + Nuevo recibo
          </button>
        }
      />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* Filtros */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
          <input
            placeholder="Buscar por folio, cliente o inmueble…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
          />
          <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Todos los tipos</option>
            <option value="compraventa">Compraventa</option>
            <option value="arrendamiento">Arrendamiento</option>
          </select>
          <select value={filtroEstatus} onChange={e => setFiltroEstatus(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff" }}>
            <option value="">Todos los estatus</option>
            <option value="activo">Activo</option>
            <option value="solicitud_recibida">Solicitud recibida</option>
            <option value="vencido">Vencido</option>
            <option value="cancelado">Cancelado</option>
            <option value="concretado">Concretado</option>
          </select>
          <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: "auto" }}>{filtered.length} recibos</span>
        </div>

        {/* Tabla */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>Cargando recibos…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "#9ca3af" }}>No se encontraron recibos.</div>
        ) : (
          <>{isMobile ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map(r => {
                const est = ESTATUS_STYLE[r.estatus] || ESTATUS_STYLE.activo;
                const pago = resumenPago(r);
                return (
                  <div key={r.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 700, color: brand.red, fontSize: 14 }}>{r.folio}</span>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: est.color, background: est.bg, padding: "3px 8px", borderRadius: 99 }}>{est.label}</span>
                        {r.estatus === "solicitud_recibida" && r.fecha_limite_firma && (
                          <div style={{ fontSize: 10, color: "#1e40af", marginTop: 2 }}>📅 Firma: {r.fecha_limite_firma}</div>
                        )}
                      </div>
                    </div>
                    <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>{r.cliente_nombre}</p>
                    <p style={{ margin: "0 0 6px", fontSize: 12, color: "#6b7280" }}>{r.inmueble}</p>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: r.tipo === "compraventa" ? "#b91c3c" : "#1e40af", background: r.tipo === "compraventa" ? "#fce8ed" : "#dbeafe", padding: "2px 8px", borderRadius: 99 }}>
                          {r.tipo === "compraventa" ? "Venta" : "Renta"}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "#1a1a2e" }}>{fmt(r.monto)}</span>
                      </div>
                      <span style={{ fontSize: 12, color: "#6b7280" }}>Recibió: {r.recibido_por || "—"}</span>
                    </div>
                    {r.monto_total_acordado && (
                      <div style={{ background: pago.saldo > 0 ? "#fff7ed" : "#f0fdf4", borderRadius: 8, padding: "7px 9px", marginBottom: 8, fontSize: 11 }}>
                        <strong>Recibido: {fmt(pago.totalRecibido)}</strong> de {fmt(pago.totalAcordado)}
                        <span style={{ marginLeft: 6, color: pago.saldo > 0 ? "#c2410c" : "#065f46" }}>
                          {pago.saldo > 0 ? `· Saldo ${fmt(pago.saldo)}` : "· Liquidado"}
                        </span>
                      </div>
                    )}
                    {(r.recibos_abonos || []).map(abono => (
                      <div key={abono.id} style={{ fontSize: 11, color: "#6b7280", marginBottom: 5 }}>
                        Abono {fmt(abono.monto)} · {abono.fecha}
                        {abono.pdf_url && <a href={abono.pdf_url} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: brand.red }}>PDF</a>}
                        {abono.comprobante_url && <a href={abono.comprobante_url} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: "#1e40af" }}>Comprobante</a>}
                        {esCarlos && <button onClick={() => regenerarPdfAbono(r, abono)} disabled={saving} style={{ marginLeft: 6, border: "none", background: "transparent", color: "#7c3aed", cursor: "pointer", padding: 0, fontSize: 11 }}>Regenerar PDF</button>}
                        {esCarlos && <button onClick={() => sincronizarAbonoConCierre(abono)} disabled={saving} style={{ marginLeft: 6, border: "none", background: "transparent", color: "#065f46", cursor: "pointer", padding: 0, fontSize: 11 }}>Aplicar a Cierres</button>}
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {r.pdf_url && (
                        <a href={r.pdf_url} target="_blank" rel="noreferrer" style={{ background: "#fce8ed", color: brand.red, fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, textDecoration: "none" }}>📄 Ver PDF</a>
                      )}
                      {r.comprobante_url && (
                        <a href={r.comprobante_url} target="_blank" rel="noreferrer" style={{ background: "#dbeafe", color: "#1e40af", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, textDecoration: "none" }}>🧾 Comprobante</a>
                      )}
                      {r.flujo_estado === "requiere_revision" && puedeIniciarFlujo && (
                        <button onClick={() => reintentarFlujo(r)} disabled={saving} style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #fdba74", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>↻ Reintentar flujo</button>
                      )}
                      {puedeRegistrarAbono && pago.saldo > 0 && r.estatus !== "cancelado" && (
                        <button onClick={() => abrirAbono(r)} disabled={saving} style={{ background: "#ecfdf5", color: "#065f46", border: "1px solid #6ee7b7", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Registrar abono</button>
                      )}
                      {/* Botones de acción según estatus */}
                      {r.estatus === "activo" && (<>
                        {r.tipo === "arrendamiento" && !r.firma_id && (
                          <button onClick={() => { setModalSolicitud(r); setFechaLimiteFirma(""); }} style={{ background: "#dbeafe", color: "#1e40af", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Solicitud recibida</button>
                        )}
                        {esCarlos && !r.firma_id && <button onClick={() => cambiarEstatus(r, "concretado")} style={{ background: "#d1fae5", color: "#065f46", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Concretado</button>}
                        <button onClick={() => cambiarEstatus(r, "cancelado")} style={{ background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✕ Cancelar</button>
                      </>)}
                      {r.estatus === "vencido" && esCarlos && (
                        <button onClick={() => handleReactivar(r)} disabled={saving} style={{ background: "#fef3c7", color: "#92400e", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>↺ Reactivar</button>
                      )}
                      {r.estatus === "concretado" && esCarlos && (
                        <button onClick={() => handleCorregirConcretado(r)} disabled={saving} style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #fdba74", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>↺ Corregir estado</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
          <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["Folio", "Tipo", "Cliente", "Inmueble", "Monto", "Recibió", "Estatus", "PDF", "Comprobante", "Acciones"].map(h => (
                    <th key={h} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const est = ESTATUS_STYLE[r.estatus] || ESTATUS_STYLE.activo;
                  const pago = resumenPago(r);
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "11px 14px", fontFamily: "monospace", fontWeight: 700, color: brand.red, fontSize: 13 }}>{r.folio}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: r.tipo === "compraventa" ? "#b91c3c" : "#1e40af", background: r.tipo === "compraventa" ? "#fce8ed" : "#dbeafe", padding: "2px 8px", borderRadius: 99 }}>
                          {r.tipo === "compraventa" ? "Venta" : "Renta"}
                        </span>
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 13, color: "#1a1a2e", fontWeight: 600 }}>{r.cliente_nombre}</td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: "#6b7280", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.inmueble}</td>
                      <td style={{ padding: "11px 14px", fontWeight: 700, fontSize: 13, color: "#1a1a2e" }}>
                        {fmt(pago.totalRecibido)}
                        {r.monto_total_acordado && (
                          <div style={{ fontSize: 10, fontWeight: 500, color: pago.saldo > 0 ? "#c2410c" : "#065f46", marginTop: 2 }}>
                            {pago.saldo > 0 ? `de ${fmt(pago.totalAcordado)} · falta ${fmt(pago.saldo)}` : "Liquidado"}
                          </div>
                        )}
                        {(r.recibos_abonos || []).map(abono => (
                          <div key={abono.id} style={{ fontSize: 10, fontWeight: 500, color: "#6b7280", marginTop: 3 }}>
                            + {fmt(abono.monto)}
                            {abono.pdf_url && <a href={abono.pdf_url} target="_blank" rel="noreferrer" style={{ marginLeft: 4, color: brand.red }}>PDF</a>}
                            {abono.comprobante_url && <a href={abono.comprobante_url} target="_blank" rel="noreferrer" style={{ marginLeft: 4, color: "#1e40af" }}>Comp.</a>}
                            {esCarlos && <button onClick={() => regenerarPdfAbono(r, abono)} disabled={saving} style={{ marginLeft: 4, border: "none", background: "transparent", color: "#7c3aed", cursor: "pointer", padding: 0, fontSize: 10 }}>Regenerar</button>}
                            {esCarlos && <button onClick={() => sincronizarAbonoConCierre(abono)} disabled={saving} style={{ marginLeft: 4, border: "none", background: "transparent", color: "#065f46", cursor: "pointer", padding: 0, fontSize: 10 }}>A Cierres</button>}
                          </div>
                        ))}
                      </td>
                      <td style={{ padding: "11px 14px", fontSize: 12, color: "#6b7280" }}>{r.recibido_por || "—"}</td>
                      <td style={{ padding: "11px 14px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: est.color, background: est.bg, padding: "3px 8px", borderRadius: 99 }}>{est.label}</span>
                        {r.flujo_estado === "requiere_revision" && (
                          <div style={{ fontSize: 10, color: "#b45309", marginTop: 3, maxWidth: 220, whiteSpace: "normal" }}>
                            ⚠ Flujo por revisar
                            {r.flujo_error && <div style={{ marginTop: 2 }}>{r.flujo_error}</div>}
                          </div>
                        )}
                        {r.estatus === "solicitud_recibida" && r.fecha_limite_firma && (
                          <div style={{ fontSize: 10, color: "#1e40af", marginTop: 3 }}>📅 Firma: {r.fecha_limite_firma}</div>
                        )}
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        {r.pdf_url
                          ? <a href={r.pdf_url} target="_blank" rel="noreferrer" style={{ color: brand.red, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>Ver PDF</a>
                          : <span style={{ color: "#d1d5db", fontSize: 12 }}>—</span>
                        }
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        {r.comprobante_url
                          ? <a href={r.comprobante_url} target="_blank" rel="noreferrer" style={{ color: "#1e40af", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>🧾 Ver</a>
                          : <span style={{ color: "#d1d5db", fontSize: 12 }}>{r.efectivo ? "Efectivo" : "—"}</span>
                        }
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {/* Activo → botones de acción */}
                          {r.estatus === "activo" && (<>
                            {r.tipo === "arrendamiento" && !r.firma_id && (
                              <button onClick={() => { setModalSolicitud(r); setFechaLimiteFirma(""); }} style={{ background: "#dbeafe", color: "#1e40af", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>✓ Solicitud recibida</button>
                            )}
                            {esCarlos && !r.firma_id && <button onClick={() => cambiarEstatus(r, "concretado")} style={{ background: "#d1fae5", color: "#065f46", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✓ Concretado</button>}
                            <button onClick={() => cambiarEstatus(r, "cancelado")} style={{ background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✕ Cancelar</button>
                          </>)}
                          {/* Vencido → Reactivar (solo Carlos) */}
                          {r.estatus === "vencido" && esCarlos && (
                            <button onClick={() => handleReactivar(r)} disabled={saving} style={{ background: "#fef3c7", color: "#92400e", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>↺ Reactivar</button>
                          )}
                          {r.estatus === "concretado" && esCarlos && (
                            <button onClick={() => handleCorregirConcretado(r)} disabled={saving} style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #fdba74", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>↺ Corregir</button>
                          )}
                          {r.flujo_estado === "requiere_revision" && puedeIniciarFlujo && (
                            <button onClick={() => reintentarFlujo(r)} disabled={saving} style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #fdba74", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>↻ Flujo</button>
                          )}
                          {puedeRegistrarAbono && pago.saldo > 0 && r.estatus !== "cancelado" && (
                            <button onClick={() => abrirAbono(r)} disabled={saving} style={{ background: "#ecfdf5", color: "#065f46", border: "1px solid #6ee7b7", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ Abono</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}</>
        )}
      </div>

      {/* Modal cancelación */}
      {modalCancelar && (
        <Modal title={`Cancelar ${modalCancelar.folio}`} onClose={() => { setModalCancelar(null); setMotivoCancelacion(""); }}>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 0 }}>
            Cliente: <strong>{modalCancelar.cliente_nombre}</strong><br />
            Monto: <strong>{fmt(modalCancelar.monto)}</strong>
          </p>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Motivo de cancelación *</label>
            <textarea
              value={motivoCancelacion}
              onChange={e => setMotivoCancelacion(e.target.value)}
              placeholder="Ej: El comprador desistió, crédito no aprobado, vencimiento de plazo…"
              rows={3}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box", resize: "vertical" }}
            />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => { setModalCancelar(null); setMotivoCancelacion(""); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>Cancelar</button>
            <button onClick={confirmarCancelacion} disabled={saving || !motivoCancelacion.trim()} style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontSize: 14, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Guardando…" : "Confirmar cancelación"}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal solicitud recibida */}
      {modalSolicitud && (
        <Modal title={`✓ Solicitud recibida — ${modalSolicitud.folio}`} onClose={() => { setModalSolicitud(null); setFechaLimiteFirma(""); }}>
          <p style={{ fontSize: 14, color: "#6b7280", marginTop: 0 }}>
            Cliente: <strong>{modalSolicitud.cliente_nombre}</strong><br />
            Inmueble: <strong>{modalSolicitud.inmueble}</strong>
          </p>
          <p style={{ fontSize: 13, color: "#374151", background: "#eff6ff", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            Al confirmar, este recibo pasará a estatus <strong>Solicitud recibida</strong>. El cron no lo vencerá hasta que llegue la fecha límite de firma que definas abajo.
          </p>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>Fecha límite de firma (Plazo 2) *</label>
            <input
              type="date"
              value={fechaLimiraFirma}
              onChange={e => setFechaLimiteFirma(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 14, boxSizing: "border-box" }}
            />
            <p style={{ fontSize: 11, color: "#9ca3af", margin: "6px 0 0" }}>Si el contrato no se firma en esta fecha, el cron lo marcará como vencido automáticamente.</p>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => { setModalSolicitud(null); setFechaLimiteFirma(""); }} style={{ background: "#f3f4f6", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>Cancelar</button>
            <button onClick={confirmarSolicitudRecibida} disabled={saving || !fechaLimiraFirma} style={{ background: "#1e40af", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, cursor: (saving || !fechaLimiraFirma) ? "not-allowed" : "pointer", fontSize: 14, opacity: (saving || !fechaLimiraFirma) ? 0.6 : 1 }}>
              {saving ? "Guardando…" : "Confirmar solicitud recibida"}
            </button>
          </div>
        </Modal>
      )}

      {modalAbono && (
        <Modal title={`Registrar abono — ${modalAbono.folio}`} onClose={() => setModalAbono(null)}>
          {(() => {
            const pago = resumenPago(modalAbono);
            return (
              <>
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "10px 12px", marginBottom: 16, fontSize: 13 }}>
                  <div>Total acordado: <strong>{fmt(pago.totalAcordado)}</strong></div>
                  <div>Recibido anteriormente: <strong>{fmt(pago.totalRecibido)}</strong></div>
                  <div>Saldo pendiente: <strong style={{ color: "#c2410c" }}>{fmt(pago.saldo)}</strong></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 5 }}>Monto *</label>
                    <input type="number" min="0.01" step="0.01" value={formAbono.monto}
                      onChange={e => setFormAbono(f => ({ ...f, monto: e.target.value }))}
                      style={{ width: "100%", boxSizing: "border-box", padding: "10px", border: "1px solid #d1d5db", borderRadius: 8 }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 5 }}>Fecha *</label>
                    <input type="date" value={formAbono.fecha}
                      onChange={e => setFormAbono(f => ({ ...f, fecha: e.target.value }))}
                      style={{ width: "100%", boxSizing: "border-box", padding: "10px", border: "1px solid #d1d5db", borderRadius: 8 }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 5 }}>Forma de pago</label>
                    <select value={formAbono.forma_pago}
                      onChange={e => setFormAbono(f => ({ ...f, forma_pago: e.target.value }))}
                      style={{ width: "100%", boxSizing: "border-box", padding: "10px", border: "1px solid #d1d5db", borderRadius: 8, background: "#fff" }}>
                      <option>Transferencia</option>
                      <option>Efectivo</option>
                      <option>Ventanilla</option>
                      <option>Tarjeta</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 5 }}>Recibido por</label>
                    <select value={formAbono.recibido_por}
                      onChange={e => setFormAbono(f => ({ ...f, recibido_por: e.target.value }))}
                      style={{ width: "100%", boxSizing: "border-box", padding: "10px", border: "1px solid #d1d5db", borderRadius: 8, background: "#fff" }}>
                      <option>Guillermo</option>
                      <option>Carlos</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 5 }}>Comprobante de pago</label>
                  <input type="file" accept="image/*,.pdf"
                    onChange={e => setFormAbono(f => ({ ...f, comprobante: e.target.files?.[0] || null }))}
                    style={{ width: "100%" }} />
                </div>
                <div style={{ marginTop: 14 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 5 }}>Notas</label>
                  <textarea rows={2} value={formAbono.notas}
                    onChange={e => setFormAbono(f => ({ ...f, notas: e.target.value }))}
                    placeholder="Ej. Complemento del apartado"
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px", border: "1px solid #d1d5db", borderRadius: 8, resize: "vertical" }} />
                </div>
                <p style={{ fontSize: 11, color: "#6b7280" }}>
                  Se generará un PDF complementario sin modificar el recibo original.
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button onClick={() => setModalAbono(null)} style={{ border: "none", borderRadius: 8, padding: "10px 16px", cursor: "pointer" }}>Cancelar</button>
                  <button onClick={guardarAbono} disabled={saving || !formAbono.monto || !formAbono.fecha}
                    style={{ background: "#065f46", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
                    {saving ? "Guardando…" : "Guardar y generar PDF"}
                  </button>
                </div>
              </>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}
