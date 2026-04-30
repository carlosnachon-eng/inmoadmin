import { useState } from "react";

const inp = {
  width: "100%", padding: "10px 14px", borderRadius: 8,
  border: "1.5px solid #e5e7eb", fontSize: 14, boxSizing: "border-box",
  fontFamily: "'Montserrat', sans-serif", color: "#1a1a2e", outline: "none",
  background: "#fff", transition: "border 0.15s",
};
const sel = { ...inp, cursor: "pointer" };
const txta = { ...inp, minHeight: 80, resize: "vertical" };

function Campo({ label, children, required }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}{required && <span style={{ color: "#C8102E" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function SecTitle({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "28px 0 20px" }}>
      <div style={{ width: 4, height: 18, background: "#C8102E", borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 800, color: "#1a1a2e", letterSpacing: "0.15em", textTransform: "uppercase" }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: "#f0f0f0" }} />
    </div>
  );
}

async function generarPDF(data) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const W = 215.9;
  const M = 16;
  const AW = W - M * 2;
  let y = 0;

  const ROJO = [200, 16, 46], OSC = [26, 26, 46], GRIS = [107, 114, 128];
  const GBG = [248, 248, 250], BRD = [229, 231, 235];
  const VBG = [220, 252, 231], VC = [22, 101, 52], VS = [34, 197, 94];
  const ABG = [254, 249, 195], AC = [133, 77, 14], AS = [234, 179, 8];
  const RBG = [254, 226, 226], RC = [153, 27, 27], RS = [239, 68, 68];
  const AZB = [239, 246, 255], AZC = [29, 78, 216];

  const addPg = () => { doc.addPage(); y = 16; };
  const chk = (n) => { if (y + n > 265) addPg(); };

  // HEADER
  doc.setFillColor(...OSC);
  doc.rect(0, 0, W, 36, "F");
  doc.setTextColor(...ROJO); doc.setFont("helvetica","bold"); doc.setFontSize(16);
  doc.text("EMPORIO", M, 14);
  doc.setTextColor(180,180,200); doc.setFont("helvetica","normal"); doc.setFontSize(7);
  doc.text("I N M O B I L I A R I O", M, 20);
  doc.setTextColor(140,140,160); doc.setFontSize(7);
  doc.text("FOLIO", W-M, 10, {align:"right"});
  doc.setTextColor(...ROJO); doc.setFont("helvetica","bold"); doc.setFontSize(18);
  doc.text(data.folio||"—", W-M, 21, {align:"right"});
  doc.setTextColor(140,140,160); doc.setFont("helvetica","normal"); doc.setFontSize(7);
  doc.text(data.fecha||"", W-M, 28, {align:"right"});
  y = 42;

  doc.setDrawColor(...ROJO); doc.setLineWidth(1);
  doc.line(M, y, W-M, y); y += 5;
  doc.setTextColor(...OSC); doc.setFont("helvetica","bold"); doc.setFontSize(11);
  doc.text("REPORTE DE INVESTIGACIÓN Y DICTAMEN DEL INQUILINO", W/2, y+5, {align:"center"});
  y += 10;
  doc.setTextColor(...ROJO); doc.setFontSize(8.5);
  doc.text("PÓLIZA JURÍDICA DE DESALOJO Y DESLINDE — HABITACIONAL", W/2, y+3, {align:"center"});
  y += 9;
  doc.setDrawColor(...BRD); doc.setLineWidth(0.3);
  doc.line(M, y, W-M, y); y += 7;

  // SEMÁFORO
  const dict = data.dictamen || "APROBADO";
  const sems = [
    {val:"APROBADO", icon:"✓", on:VS, bg:VBG, tc:VC, lbl:"APROBADO"},
    {val:"APROBADO CON CONDICIONES", icon:"!", on:AS, bg:ABG, tc:AC, lbl:"CON COND."},
    {val:"NO APROBADO", icon:"✗", on:RS, bg:RBG, tc:RC, lbl:"NO APROBADO"},
  ];
  const semH = 26;
  doc.setFillColor(...GBG);
  doc.roundedRect(M, y, AW, semH, 4, 4, "F");
  const sw = AW/3;
  sems.forEach((s,i) => {
    const cx = M + sw*i + sw/2, cy = y + semH/2 - 2;
    const act = dict === s.val;
    act ? (doc.setFillColor(...s.bg), doc.setDrawColor(...s.on), doc.setLineWidth(1.2))
        : (doc.setFillColor(243,244,246), doc.setDrawColor(...BRD), doc.setLineWidth(0.5));
    doc.circle(cx, cy, 7, "FD");
    doc.setFont("helvetica","bold"); doc.setFontSize(act?10:7);
    doc.setTextColor(...(act?s.on:[209,213,219]));
    doc.text(s.icon, cx, cy+3, {align:"center"});
    doc.setFont("helvetica", act?"bold":"normal"); doc.setFontSize(6);
    doc.setTextColor(...(act?s.tc:GRIS));
    doc.text(s.lbl, cx, y+semH-2, {align:"center"});
  });
  y += semH + 8;

  // helpers
  const st = (t) => {
    chk(14);
    doc.setFillColor(...ROJO); doc.rect(M, y, 3, 6, "F");
    doc.setTextColor(...ROJO); doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
    doc.text(t, M+6, y+4.5); y += 10;
  };
  const c2 = (l1,v1,l2,v2) => {
    chk(16); const h = AW/2-2;
    [[l1,v1,M],[l2,v2,M+h+4]].forEach(([l,v,x]) => {
      doc.setFillColor(...GBG); doc.roundedRect(x,y,h,15,2,2,"F");
      doc.setTextColor(...GRIS); doc.setFont("helvetica","normal"); doc.setFontSize(6.5);
      doc.text((l||"").toUpperCase(), x+4, y+5);
      doc.setTextColor(...OSC); doc.setFont("helvetica","bold"); doc.setFontSize(8.5);
      const vv = doc.splitTextToSize(v||"—", h-8);
      doc.text(vv[0], x+4, y+11);
    });
    y += 17;
  };
  const c3 = (l1,v1,l2,v2,l3,v3) => {
    chk(16); const t = AW/3-1.5;
    [[l1,v1,0],[l2,v2,1],[l3,v3,2]].forEach(([l,v,i]) => {
      const x = M+(t+2.25)*i;
      doc.setFillColor(...GBG); doc.roundedRect(x,y,t,15,2,2,"F");
      doc.setTextColor(...GRIS); doc.setFont("helvetica","normal"); doc.setFontSize(6);
      doc.text((l||"").toUpperCase(), x+4, y+5);
      doc.setTextColor(...OSC); doc.setFont("helvetica","bold"); doc.setFontSize(8);
      doc.text(doc.splitTextToSize(v||"—",t-8)[0], x+4, y+11);
    });
    y += 17;
  };
  const ctxt = (l,v) => {
    if (!v) return; chk(20);
    doc.setTextColor(...GRIS); doc.setFont("helvetica","normal"); doc.setFontSize(6.5);
    doc.text((l||"").toUpperCase(), M, y+4); y += 6;
    const lines = doc.splitTextToSize(v, AW-8);
    const h = lines.length*4.5+8; chk(h);
    doc.setFillColor(...GBG); doc.roundedRect(M,y,AW,h,2,2,"F");
    doc.setTextColor(...OSC); doc.setFont("helvetica","normal"); doc.setFontSize(8);
    doc.text(lines, M+4, y+6); y += h+4;
  };

  // I. DATOS
  st("I. DATOS GENERALES");
  c2("Nombre del solicitante", data.nombre_solicitante, "Tipo de solicitante", data.tipo_solicitante);
  c3("Tipo de identificación", data.tipo_identificacion, "Núm. de identificación", data.num_identificacion, "Fecha de nacimiento", data.fecha_nacimiento);
  c3("Teléfono", data.telefono_inquilino, "Correo electrónico", data.correo_inquilino, "Tiempo en dom. anterior", data.tiempo_domicilio_anterior);
  c2("Domicilio anterior", data.domicilio_anterior, "Dirección del inmueble", data.direccion_inmueble);
  c3("Monto de renta", data.monto_renta, "Fecha de inicio", data.fecha_inicio, "Tipo de solicitud", data.tipo_solicitante);

  // II. ACTIVIDAD
  st("II. ACTIVIDAD Y FUENTE DE INGRESOS");
  c2("Actividad principal", data.actividad_principal, "Fuente de ingresos", data.fuente_ingresos);
  c3("Empresa / Empleador", data.empresa, "Teléfono RRHH", data.tel_empresa, "Ingreso mensual", data.ingreso_mensual);
  c3("Relación ingreso-renta", data.relacion_ingreso_renta, "Comprobante de ingresos", data.comprobante_ingresos, "Evaluación financiera", "Completada");

  // III. USO
  st("III. USO DEL INMUEBLE / OCUPANTES");
  c3("Uso declarado", data.uso_declarado, "Descripción", data.descripcion_uso, "Núm. de ocupantes", data.num_ocupantes);
  c3("Mascotas", data.mascotas, "Personal de servicio", data.personal_servicio, "Modalidad", data.modalidad_servicio||"—");

  // IV. REFERENCIAS
  if (data.ref1_nombre||data.ref2_nombre) {
    st("IV. REFERENCIAS PERSONALES");
    if (data.ref1_nombre) c3("Referencia 1 — Nombre", data.ref1_nombre, "Teléfono", data.ref1_telefono, "Relación", data.ref1_relacion);
    if (data.ref2_nombre) c3("Referencia 2 — Nombre", data.ref2_nombre, "Teléfono", data.ref2_telefono, "Relación", data.ref2_relacion);
  }

  // V. ANTECEDENTES
  st("V. ANTECEDENTES LEGALES — BUROMEXICO");
  chk(18);
  const sinA = data.resultado_legal==="Sin antecedentes";
  doc.setFillColor(...(sinA?VBG:RBG)); doc.setDrawColor(...(sinA?VC:RC)); doc.setLineWidth(0.8);
  doc.roundedRect(M,y,AW,14,3,3,"FD");
  doc.setTextColor(...(sinA?VC:RC)); doc.setFont("helvetica","bold"); doc.setFontSize(9);
  doc.text(sinA?"✓  SIN ANTECEDENTES LEGALES RELEVANTES":"⚠  CON ANTECEDENTES — VER OBSERVACIONES", W/2, y+9, {align:"center"});
  y += 18;
  if (data.observaciones_legales) ctxt("Observaciones de antecedentes", data.observaciones_legales);

  // VI. REVISIÓN
  st("VI. REFERENCIAS E HISTORIAL / REVISIÓN LEGAL");
  ctxt("Historial de referencias", data.referencias);
  ctxt("Revisión legal", data.revision_legal);

  // VII. CONCLUSIÓN
  st("VII. CONCLUSIÓN Y RECOMENDACIÓN");
  ctxt("Conclusión", data.conclusion);
  if (data.observaciones_analista) {
    chk(24);
    const ol = doc.splitTextToSize(data.observaciones_analista, AW-12);
    const oh = ol.length*4.5+14; chk(oh);
    doc.setFillColor(...AZB); doc.setDrawColor(...AZC); doc.setLineWidth(0.8);
    doc.roundedRect(M,y,AW,oh,3,3,"FD");
    doc.setTextColor(...AZC); doc.setFont("helvetica","bold"); doc.setFontSize(6.5);
    doc.text("OBSERVACIONES DEL ANALISTA", M+6, y+6);
    doc.setTextColor(...OSC); doc.setFont("helvetica","normal"); doc.setFontSize(8);
    doc.text(ol, M+6, y+12); y += oh+6;
  }

  // VIII. DICTAMEN
  chk(30); st("VIII. DICTAMEN FINAL");
  const [dbg,dc,dtxt] = dict==="APROBADO" ? [VBG,VC,"✓  APROBADO"]
    : dict==="APROBADO CON CONDICIONES" ? [ABG,AC,"⚠  APROBADO CON CONDICIONES"]
    : [RBG,RC,"✗  NO APROBADO"];
  chk(22);
  doc.setFillColor(...dbg); doc.setDrawColor(...dc); doc.setLineWidth(1.5);
  doc.roundedRect(M,y,AW,20,4,4,"FD");
  doc.setTextColor(...dc); doc.setFont("helvetica","bold"); doc.setFontSize(14);
  doc.text(dtxt, W/2, y+13, {align:"center"}); y += 24;
  if (data.condiciones) {
    doc.setTextColor(...GRIS); doc.setFont("helvetica","normal"); doc.setFontSize(8);
    doc.text(`Condiciones: ${data.condiciones}`, W/2, y+5, {align:"center"}); y += 10;
  }

  // IX. DESLINDE
  chk(20);
  doc.setDrawColor(...BRD); doc.setLineWidth(0.3); doc.line(M,y,W-M,y); y += 6;
  doc.setFillColor(...ROJO); doc.rect(M,y,3,5,"F");
  doc.setTextColor(...ROJO); doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
  doc.text("IX. DESLINDE LEGAL", M+6, y+4); y += 8;
  doc.setTextColor(...GRIS); doc.setFont("helvetica","normal"); doc.setFontSize(7.5);
  const dl = doc.splitTextToSize("El presente reporte y dictamen se emite con base en la información proporcionada por el solicitante y bajo un estándar de diligencia razonable, sin constituir garantía de pago ni sustituir resoluciones judiciales.", AW);
  doc.text(dl, M, y); y += dl.length*4+6;

  // X. FIRMA
  chk(35);
  doc.setFillColor(...ROJO); doc.rect(M,y,3,5,"F");
  doc.setTextColor(...ROJO); doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
  doc.text("X. FIRMA", M+6, y+4); y += 10;
  const t3 = AW/3;
  [[M,"ANALISTA",data.analista,"Firma autorizada"],
   [M+t3,"FECHA DE EMISIÓN",data.fecha,""],
   [M+t3*2,"EMITIDO POR","EMPORIO INMOBILIARIO","emporioinmobiliario.com.mx"]
  ].forEach(([x,l,v,sub]) => {
    doc.setTextColor(...GRIS); doc.setFont("helvetica","normal"); doc.setFontSize(6.5);
    doc.text(l, x, y);
    const isEmp = v==="EMPORIO INMOBILIARIO";
    doc.setTextColor(isEmp?ROJO[0]:OSC[0], isEmp?ROJO[1]:OSC[1], isEmp?ROJO[2]:OSC[2]);
    doc.setFont("helvetica","bold"); doc.setFontSize(isEmp?9:8.5);
    doc.text(v||"—", x, y+6);
    if (sub) {
      doc.setTextColor(...GRIS); doc.setFont("helvetica","normal"); doc.setFontSize(7);
      doc.text(sub, x, y+11);
    }
  });
  // Línea de firma
  doc.setDrawColor(...OSC); doc.setLineWidth(0.5);
  doc.line(M, y+22, M+t3-6, y+22); y += 32;

  // FOOTER en todas las páginas
  const np = doc.internal.getNumberOfPages();
  for (let i=1;i<=np;i++) {
    doc.setPage(i);
    const ph = doc.internal.pageSize.height;
    doc.setFillColor(...ROJO); doc.rect(0,ph-10,W,10,"F");
    doc.setTextColor(255,255,255); doc.setFont("helvetica","normal"); doc.setFontSize(6.5);
    doc.text("EMPORIO INMOBILIARIO  ·  Reserva Territorial Atlixcayotl, San Andrés Cholula, Puebla  ·  222 257 3237  ·  ventas@emporioinmobiliario.mx", W/2, ph-3.5, {align:"center"});
    if (np>1) doc.text(`${i}/${np}`, W-M, ph-3.5, {align:"right"});
  }

  return doc;
}

export default function Dictamen() {
  const [generando, setGenerando] = useState(false);
  const [guardado,  setGuardado]  = useState(false);
  const [form, setForm] = useState({
    folio:"", fecha: new Date().toLocaleDateString("es-MX"),
    nombre_solicitante:"", tipo_solicitante:"PERSONA FÍSICA",
    tipo_identificacion:"INE", num_identificacion:"", fecha_nacimiento:"",
    telefono_inquilino:"", correo_inquilino:"",
    domicilio_anterior:"", tiempo_domicilio_anterior:"",
    direccion_inmueble:"", monto_renta:"", fecha_inicio:"",
    actividad_principal:"", fuente_ingresos:"NÓMINA",
    empresa:"", tel_empresa:"", ingreso_mensual:"",
    relacion_ingreso_renta:"Adecuada",
    comprobante_ingresos:"Sí — 3 recibos de nómina presentados",
    uso_declarado:"HABITACIONAL", descripcion_uso:"",
    num_ocupantes:"", mascotas:"No", personal_servicio:"No", modalidad_servicio:"",
    ref1_nombre:"", ref1_telefono:"", ref1_relacion:"",
    ref2_nombre:"", ref2_telefono:"", ref2_relacion:"",
    resultado_legal:"Sin antecedentes", observaciones_legales:"",
    referencias:"Se revisaron referencias e historial de arrendamiento, no detectándose alertas relevantes para el propietario.",
    revision_legal:"Se realizó verificación de identidad y consulta de antecedentes jurídicos en plataforma BuroMexico. No se detectaron impedimentos legales, inconsistencias relevantes ni riesgos jurídicos.",
    conclusion:"Derivado de la investigación realizada, el perfil de los solicitantes resulta congruente con el inmueble y el monto de renta.",
    observaciones_analista:"",
    dictamen:"APROBADO", condiciones:"",
    analista:"LIC. ZAYETZY MONTES LUNA",
  });
  const set = (k,v) => setForm(f => ({...f,[k]:v}));

  const handleGenerar = async () => {
    if (!form.folio||!form.nombre_solicitante) { alert("Completa el Folio y Nombre del solicitante."); return; }
    setGenerando(true);
    try {
      const doc = await generarPDF(form);
      doc.save(`Dictamen_${form.folio}_${form.nombre_solicitante.split(" ")[0]}.pdf`);
      setGuardado(true); setTimeout(()=>setGuardado(false),3000);
    } catch(e) { alert("Error: "+e.message); }
    setGenerando(false);
  };

  const DOPTS = [
    {value:"APROBADO", color:"#22c55e", bg:"#dcfce7", tc:"#166534", icon:"✓", label:"APROBADO"},
    {value:"APROBADO CON CONDICIONES", color:"#eab308", bg:"#fef9c3", tc:"#854d0e", icon:"!", label:"CON CONDICIONES"},
    {value:"NO APROBADO", color:"#ef4444", bg:"#fee2e2", tc:"#991b1b", icon:"✗", label:"NO APROBADO"},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#f4f5f7",fontFamily:"'Montserrat',system-ui,sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>

      <div style={{background:"#1a1a2e",padding:"20px 32px",display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:"0 2px 16px rgba(0,0,0,0.2)"}}>
        <div>
          <p style={{margin:0,fontSize:11,color:"#C8102E",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>Emporio Inmobiliario</p>
          <h1 style={{margin:"4px 0 0",fontSize:20,fontWeight:800,color:"#fff"}}>📋 Generador de Dictamen</h1>
          <p style={{margin:"4px 0 0",fontSize:12,color:"rgba(255,255,255,0.4)"}}>Póliza Jurídica de Desalojo y Deslinde — Habitacional</p>
        </div>
        <a href="/" style={{color:"#c8a96e",fontSize:13,fontWeight:600,textDecoration:"none"}}>← Panel admin</a>
      </div>

      <div style={{maxWidth:980,margin:"0 auto",padding:"32px 20px"}}>

        {/* Dictamen */}
        <div style={{background:"#fff",borderRadius:20,padding:"28px 32px",marginBottom:20,border:"1px solid #f0f0f0",boxShadow:"0 2px 16px rgba(0,0,0,0.04)"}}>
          <p style={{margin:"0 0 20px",fontSize:11,fontWeight:800,color:"#C8102E",letterSpacing:"0.15em",textTransform:"uppercase"}}>Dictamen Final</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
            {DOPTS.map(opt=>(
              <button key={opt.value} onClick={()=>set("dictamen",opt.value)} style={{
                padding:"20px 12px",borderRadius:14,cursor:"pointer",textAlign:"center",
                border:form.dictamen===opt.value?`2.5px solid ${opt.color}`:"2px solid #f3f4f6",
                background:form.dictamen===opt.value?opt.bg:"#fafafa",transition:"all 0.2s",
              }}>
                <div style={{width:48,height:48,borderRadius:"50%",margin:"0 auto 12px",
                  background:form.dictamen===opt.value?opt.bg:"#f3f4f6",
                  border:form.dictamen===opt.value?`3px solid ${opt.color}`:"2px solid #e5e7eb",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:22,fontWeight:900,transition:"all 0.2s",
                  color:form.dictamen===opt.value?opt.color:"#d1d5db"
                }}>{opt.icon}</div>
                <p style={{margin:0,fontSize:13,fontWeight:800,color:form.dictamen===opt.value?opt.tc:"#9ca3af"}}>{opt.label}</p>
              </button>
            ))}
          </div>
          {form.dictamen==="APROBADO CON CONDICIONES" && (
            <div style={{marginTop:20}}>
              <Campo label="Especifica las condiciones">
                <input value={form.condiciones} onChange={e=>set("condiciones",e.target.value)} placeholder="Ej. Requiere aval adicional..." style={inp}/>
              </Campo>
            </div>
          )}
        </div>

        {/* Formulario */}
        <div style={{background:"#fff",borderRadius:20,padding:"28px 32px",border:"1px solid #f0f0f0",boxShadow:"0 2px 16px rgba(0,0,0,0.04)"}}>

          <SecTitle>I. Datos Generales</SecTitle>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
            <Campo label="Folio" required><input value={form.folio} onChange={e=>set("folio",e.target.value)} placeholder="E646" style={inp}/></Campo>
            <Campo label="Fecha"><input value={form.fecha} onChange={e=>set("fecha",e.target.value)} style={inp}/></Campo>
            <Campo label="Tipo de solicitante"><select value={form.tipo_solicitante} onChange={e=>set("tipo_solicitante",e.target.value)} style={sel}><option>PERSONA FÍSICA</option><option>PERSONA MORAL</option></select></Campo>
          </div>
          <Campo label="Nombre completo del solicitante" required><input value={form.nombre_solicitante} onChange={e=>set("nombre_solicitante",e.target.value)} placeholder="Nombre completo tal como aparece en identificación" style={inp}/></Campo>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
            <Campo label="Tipo de identificación"><select value={form.tipo_identificacion} onChange={e=>set("tipo_identificacion",e.target.value)} style={sel}><option>INE</option><option>Pasaporte</option><option>Cédula Profesional</option><option>Otro</option></select></Campo>
            <Campo label="Número de identificación"><input value={form.num_identificacion} onChange={e=>set("num_identificacion",e.target.value)} placeholder="Clave de elector" style={inp}/></Campo>
            <Campo label="Fecha de nacimiento"><input value={form.fecha_nacimiento} onChange={e=>set("fecha_nacimiento",e.target.value)} placeholder="DD/MM/AAAA" style={inp}/></Campo>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <Campo label="Teléfono del inquilino"><input value={form.telefono_inquilino} onChange={e=>set("telefono_inquilino",e.target.value)} placeholder="222 123 4567" style={inp}/></Campo>
            <Campo label="Correo electrónico"><input value={form.correo_inquilino} onChange={e=>set("correo_inquilino",e.target.value)} placeholder="inquilino@correo.com" style={inp}/></Campo>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16}}>
            <Campo label="Domicilio anterior"><input value={form.domicilio_anterior} onChange={e=>set("domicilio_anterior",e.target.value)} placeholder="Calle, número, colonia, ciudad" style={inp}/></Campo>
            <Campo label="Tiempo vivido ahí"><input value={form.tiempo_domicilio_anterior} onChange={e=>set("tiempo_domicilio_anterior",e.target.value)} placeholder="Ej. 2 años" style={inp}/></Campo>
          </div>
          <Campo label="Dirección del inmueble a rentar" required><input value={form.direccion_inmueble} onChange={e=>set("direccion_inmueble",e.target.value)} placeholder="Dirección completa" style={inp}/></Campo>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <Campo label="Monto de renta mensual" required><input value={form.monto_renta} onChange={e=>set("monto_renta",e.target.value)} placeholder="$16,000.00 (DIECISÉIS MIL 00/100 M.N)" style={inp}/></Campo>
            <Campo label="Fecha de inicio del contrato"><input value={form.fecha_inicio} onChange={e=>set("fecha_inicio",e.target.value)} placeholder="01/05/2026" style={inp}/></Campo>
          </div>

          <SecTitle>II. Actividad y Fuente de Ingresos</SecTitle>
          <Campo label="Actividad principal"><input value={form.actividad_principal} onChange={e=>set("actividad_principal",e.target.value)} placeholder="Profesión u ocupación" style={inp}/></Campo>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
            <Campo label="Fuente de ingresos"><select value={form.fuente_ingresos} onChange={e=>set("fuente_ingresos",e.target.value)} style={sel}><option>NÓMINA</option><option>HONORARIOS</option><option>NEGOCIO PROPIO</option><option>PENSIÓN</option><option>INVERSIONES</option><option>OTRA</option></select></Campo>
            <Campo label="Empresa / Empleador"><input value={form.empresa} onChange={e=>set("empresa",e.target.value)} placeholder="Nombre de la empresa" style={inp}/></Campo>
            <Campo label="Teléfono RRHH"><input value={form.tel_empresa} onChange={e=>set("tel_empresa",e.target.value)} placeholder="222 000 0000" style={inp}/></Campo>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
            <Campo label="Ingreso mensual"><input value={form.ingreso_mensual} onChange={e=>set("ingreso_mensual",e.target.value)} placeholder="$36,000.00" style={inp}/></Campo>
            <Campo label="Relación ingreso-renta"><select value={form.relacion_ingreso_renta} onChange={e=>set("relacion_ingreso_renta",e.target.value)} style={sel}><option>Adecuada</option><option>Adecuada — ingresos 2x el monto</option><option>Adecuada — ingresos 2.5x el monto</option><option>Adecuada — ingresos 3x el monto</option><option>Ajustada</option><option>Insuficiente</option></select></Campo>
            <Campo label="Comprobante de ingresos"><select value={form.comprobante_ingresos} onChange={e=>set("comprobante_ingresos",e.target.value)} style={sel}><option>Sí — 3 recibos de nómina presentados</option><option>Sí — estados de cuenta</option><option>Sí — declaración fiscal</option><option>Parcial — documentación incompleta</option><option>No presentado</option></select></Campo>
          </div>

          <SecTitle>III. Uso del Inmueble y Ocupantes</SecTitle>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <Campo label="Uso declarado"><select value={form.uso_declarado} onChange={e=>set("uso_declarado",e.target.value)} style={sel}><option>HABITACIONAL</option><option>COMERCIAL</option><option>MIXTO</option></select></Campo>
            <Campo label="Descripción del uso"><input value={form.descripcion_uso} onChange={e=>set("descripcion_uso",e.target.value)} placeholder="Ej. Casa familiar..." style={inp}/></Campo>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
            <Campo label="Número de ocupantes"><input value={form.num_ocupantes} onChange={e=>set("num_ocupantes",e.target.value)} placeholder="Ej. 2 personas" style={inp}/></Campo>
            <Campo label="Mascotas"><select value={form.mascotas} onChange={e=>set("mascotas",e.target.value)} style={sel}><option>No</option><option>Sí — perro</option><option>Sí — gato</option><option>Sí — especificar</option></select></Campo>
            <Campo label="Personal de servicio"><select value={form.personal_servicio} onChange={e=>set("personal_servicio",e.target.value)} style={sel}><option>No</option><option>Sí — entrada y salida</option><option>Sí — de planta</option></select></Campo>
          </div>

          <SecTitle>IV. Referencias Personales</SecTitle>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:16}}>
            <Campo label="Referencia 1 — Nombre"><input value={form.ref1_nombre} onChange={e=>set("ref1_nombre",e.target.value)} placeholder="Nombre completo" style={inp}/></Campo>
            <Campo label="Teléfono"><input value={form.ref1_telefono} onChange={e=>set("ref1_telefono",e.target.value)} placeholder="222 000 0000" style={inp}/></Campo>
            <Campo label="Relación"><input value={form.ref1_relacion} onChange={e=>set("ref1_relacion",e.target.value)} placeholder="Colega, familiar..." style={inp}/></Campo>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:16}}>
            <Campo label="Referencia 2 — Nombre"><input value={form.ref2_nombre} onChange={e=>set("ref2_nombre",e.target.value)} placeholder="Nombre completo" style={inp}/></Campo>
            <Campo label="Teléfono"><input value={form.ref2_telefono} onChange={e=>set("ref2_telefono",e.target.value)} placeholder="222 000 0000" style={inp}/></Campo>
            <Campo label="Relación"><input value={form.ref2_relacion} onChange={e=>set("ref2_relacion",e.target.value)} placeholder="Amigo, vecino..." style={inp}/></Campo>
          </div>

          <SecTitle>V. Antecedentes Legales — BuroMexico</SecTitle>
          <div style={{display:"flex",gap:16,marginBottom:16}}>
            {["Sin antecedentes","Con antecedentes"].map(opt=>(
              <button key={opt} onClick={()=>set("resultado_legal",opt)} style={{
                flex:1,padding:"14px",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:14,
                fontFamily:"'Montserrat',sans-serif",border:"2px solid",transition:"all 0.15s",
                borderColor:form.resultado_legal===opt?(opt==="Sin antecedentes"?"#22c55e":"#ef4444"):"#e5e7eb",
                background:form.resultado_legal===opt?(opt==="Sin antecedentes"?"#dcfce7":"#fee2e2"):"#fafafa",
                color:form.resultado_legal===opt?(opt==="Sin antecedentes"?"#166534":"#991b1b"):"#9ca3af",
              }}>{opt==="Sin antecedentes"?"✓ ":"⚠ "}{opt}</button>
            ))}
          </div>
          {form.resultado_legal==="Con antecedentes" && (
            <Campo label="Descripción de antecedentes">
              <textarea value={form.observaciones_legales} onChange={e=>set("observaciones_legales",e.target.value)} placeholder="Describe los antecedentes..." style={txta}/>
            </Campo>
          )}

          <SecTitle>VI. Conclusión y Observaciones</SecTitle>
          <Campo label="Conclusión y recomendación">
            <textarea value={form.conclusion} onChange={e=>set("conclusion",e.target.value)} style={{...txta,minHeight:90}}/>
          </Campo>
          <Campo label="Observaciones adicionales del analista">
            <textarea value={form.observaciones_analista} onChange={e=>set("observaciones_analista",e.target.value)} placeholder="Notas adicionales, contexto relevante para el propietario..." style={txta}/>
          </Campo>

          <SecTitle>VII. Firma</SecTitle>
          <Campo label="Analista responsable">
            <select value={form.analista} onChange={e=>set("analista",e.target.value)} style={sel}>
              <option>LIC. ZAYETZY MONTES LUNA</option>
              <option>LIC. CARLOS NACHÓN</option>
              <option>OTRO</option>
            </select>
          </Campo>

          {/* Botón */}
          <div style={{marginTop:32,paddingTop:24,borderTop:"2px solid #f3f4f6"}}>
            <button onClick={handleGenerar} disabled={generando} style={{
              width:"100%",
              background: guardado?"#22c55e":generando?"#9ca3af":"#C8102E",
              color:"#fff",border:"none",borderRadius:14,padding:"18px",
              fontWeight:900,fontSize:17,cursor:generando?"not-allowed":"pointer",
              fontFamily:"'Montserrat',sans-serif",transition:"background 0.3s",
              boxShadow:"0 4px 16px rgba(200,16,46,0.25)",
            }}>
              {guardado?"✅ PDF descargado correctamente":generando?"⏳ Generando PDF...":"📄 Generar y Descargar Dictamen PDF"}
            </button>
            <p style={{textAlign:"center",fontSize:12,color:"#9ca3af",marginTop:12,fontFamily:"'Montserrat',sans-serif"}}>
              Se descarga automáticamente · No requiere servidor · 100% en el navegador
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
