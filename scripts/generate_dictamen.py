#!/usr/bin/env python3
import sys
import json
import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor, white
from reportlab.lib.units import inch
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                 TableStyle, Image, Flowable)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY

# ── Colores ──────────────────────────────────────────────────────────────────
ROJO         = HexColor("#C8102E")
GRIS_OSCURO  = HexColor("#1a1a2e")
GRIS_MEDIO   = HexColor("#4a4a5a")
GRIS_CLARO   = HexColor("#6b7280")
GRIS_BG      = HexColor("#f8f8fa")
GRIS_BORDE   = HexColor("#e5e7eb")
VERDE        = HexColor("#166534")
VERDE_BG     = HexColor("#dcfce7")
VERDE_SEM    = HexColor("#22c55e")
AMARILLO     = HexColor("#854d0e")
AMARILLO_BG  = HexColor("#fef9c3")
AMARILLO_SEM = HexColor("#eab308")
ROJO_SEM     = HexColor("#ef4444")
ROJO_BG      = HexColor("#fee2e2")
ROJO_TEXTO   = HexColor("#991b1b")
AZUL_BG      = HexColor("#eff6ff")
AZUL         = HexColor("#1d4ed8")

W, H = letter
LOGO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logo_emporio.jpeg")


def S(name, **kwargs):
    return ParagraphStyle(name, **kwargs)


class LineDivider(Flowable):
    def __init__(self, color=None, thickness=1, width=None):
        Flowable.__init__(self)
        self.color = color or GRIS_BORDE
        self.thickness = thickness
        self.width_val = width
        self.height = thickness + 6

    def draw(self):
        w = self.width_val or 7.2 * inch
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, self.thickness / 2, w, self.thickness / 2)


class SemaforoFlowable(Flowable):
    def __init__(self, dictamen, size=52):
        Flowable.__init__(self)
        self.dictamen = dictamen
        self.size = size
        self.width = size * 5
        self.height = size * 1.7

    def draw(self):
        c = self.canv
        s = self.size
        estados = [
            ("APROBADO",                VERDE_SEM,    "#d1fae5", "✓", "APROBADO"),
            ("APROBADO CON CONDICIONES", AMARILLO_SEM, "#fef9c3", "!", "CON CONDICIONES"),
            ("NO APROBADO",             ROJO_SEM,     "#fee2e2", "✗", "NO APROBADO"),
        ]
        gap = s * 1.7
        total_w = gap * 3
        x_offset = (7.2 * inch - total_w) / 2

        for i, (estado, color_on, color_off_hex, simbolo, label) in enumerate(estados):
            cx = x_offset + i * gap + s * 0.85
            cy = s * 0.9
            activo = self.dictamen == estado

            if activo:
                c.setFillColor(HexColor(color_off_hex))
                c.setStrokeColor(color_on)
                c.setLineWidth(3.5)
            else:
                c.setFillColor(HexColor("#f3f4f6"))
                c.setStrokeColor(GRIS_BORDE)
                c.setLineWidth(1)
            c.circle(cx, cy, s * 0.58, fill=1, stroke=1)

            c.setFont("Helvetica-Bold", s * 0.38)
            c.setFillColor(color_on if activo else HexColor("#d1d5db"))
            c.drawCentredString(cx, cy - s * 0.14, simbolo)

            c.setFont("Helvetica-Bold" if activo else "Helvetica", s * 0.17)
            c.setFillColor(color_on if activo else GRIS_CLARO)
            c.drawCentredString(cx, cy - s * 0.82, label)


def generate_dictamen_pdf(data: dict, output_path: str):
    doc = SimpleDocTemplate(
        output_path, pagesize=letter,
        rightMargin=0.65*inch, leftMargin=0.65*inch,
        topMargin=0.5*inch, bottomMargin=0.65*inch,
    )

    # Estilos base
    lbl = S("lbl", fontSize=7.5, textColor=GRIS_CLARO,  fontName="Helvetica",      spaceAfter=2,  leading=10)
    val = S("val", fontSize=10,  textColor=GRIS_OSCURO, fontName="Helvetica-Bold", spaceAfter=0,  leading=13)
    val_n = S("vln", fontSize=10, textColor=GRIS_MEDIO, fontName="Helvetica",      spaceAfter=0,  leading=13)
    sec = S("sec", fontSize=8.5, textColor=ROJO,        fontName="Helvetica-Bold", spaceAfter=5,  leading=11)
    body = S("bod", fontSize=9.5, textColor=GRIS_MEDIO, fontName="Helvetica",      leading=14,    spaceAfter=4, alignment=TA_JUSTIFY)

    story = []

    # ══ HEADER ════════════════════════════════════════════════════════════════
    if os.path.exists(LOGO_PATH):
        try:
            logo_cell = Image(LOGO_PATH, width=1.9*inch, height=1.05*inch)
            logo_cell.hAlign = "LEFT"
        except:
            logo_cell = Paragraph('<font color="#C8102E" size="18"><b>EMPORIO</b></font>',
                                   S("lg", alignment=TA_LEFT, leading=22))
    else:
        logo_cell = Paragraph('<font color="#C8102E" size="18"><b>EMPORIO</b></font>',
                               S("lg", alignment=TA_LEFT, leading=22))

    folio_cell = [
        Paragraph("FOLIO", S("fl", fontSize=8, textColor=GRIS_CLARO, fontName="Helvetica", alignment=TA_RIGHT)),
        Paragraph(data.get("folio", "—"), S("fv", fontSize=22, textColor=ROJO, fontName="Helvetica-Bold", leading=26, alignment=TA_RIGHT)),
        Paragraph(data.get("fecha", ""), S("fd", fontSize=8, textColor=GRIS_CLARO, fontName="Helvetica", alignment=TA_RIGHT, leading=10)),
    ]

    ht = Table([[logo_cell, folio_cell]], colWidths=[3.5*inch, 3.5*inch])
    ht.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"MIDDLE"),("ALIGN",(1,0),(1,0),"RIGHT")]))
    story.append(ht)
    story.append(Spacer(1, 6))
    story.append(LineDivider(color=ROJO, thickness=3))
    story.append(Spacer(1, 10))

    story.append(Paragraph("REPORTE DE INVESTIGACIÓN Y DICTAMEN DEL INQUILINO",
        S("tit", fontSize=13, textColor=GRIS_OSCURO, fontName="Helvetica-Bold", leading=17, alignment=TA_CENTER, spaceAfter=3)))
    story.append(Paragraph("PÓLIZA JURÍDICA DE DESALOJO Y DESLINDE — HABITACIONAL",
        S("sub", fontSize=10, textColor=ROJO, fontName="Helvetica-Bold", leading=13, alignment=TA_CENTER, spaceAfter=2)))
    story.append(Spacer(1, 12))
    story.append(LineDivider(color=GRIS_BORDE))
    story.append(Spacer(1, 12))

    # ══ SEMÁFORO ══════════════════════════════════════════════════════════════
    dictamen = data.get("dictamen", "APROBADO")
    sem_t = Table([[SemaforoFlowable(dictamen, size=52)]], colWidths=[7.2*inch])
    sem_t.setStyle(TableStyle([
        ("ALIGN",(0,0),(-1,-1),"CENTER"),
        ("BACKGROUND",(0,0),(-1,-1),GRIS_BG),
        ("TOPPADDING",(0,0),(-1,-1),16),
        ("BOTTOMPADDING",(0,0),(-1,-1),16),
        ("ROUNDEDCORNERS",[10,10,10,10]),
    ]))
    story.append(sem_t)
    story.append(Spacer(1, 14))

    # ── helpers ───────────────────────────────────────────────────────────────
    def campo(label, valor, bold=True):
        return [Paragraph(label.upper(), lbl),
                Paragraph(valor or "—", val if bold else val_n)]

    def fila(izq, der, bg=None):
        t = Table([[izq, der]], colWidths=[3.5*inch, 3.5*inch])
        t.setStyle(TableStyle([
            ("VALIGN",(0,0),(-1,-1),"TOP"),
            ("BACKGROUND",(0,0),(-1,-1), bg or GRIS_BG),
            ("TOPPADDING",(0,0),(-1,-1),10),
            ("BOTTOMPADDING",(0,0),(-1,-1),10),
            ("LEFTPADDING",(0,0),(-1,-1),12),
            ("RIGHTPADDING",(0,0),(-1,-1),12),
            ("LINEAFTER",(0,0),(0,-1),1,GRIS_BORDE),
        ]))
        return t

    def fila3(a, b, c, bg=None):
        t = Table([[a, b, c]], colWidths=[2.4*inch, 2.4*inch, 2.4*inch])
        t.setStyle(TableStyle([
            ("VALIGN",(0,0),(-1,-1),"TOP"),
            ("BACKGROUND",(0,0),(-1,-1), bg or GRIS_BG),
            ("TOPPADDING",(0,0),(-1,-1),10),
            ("BOTTOMPADDING",(0,0),(-1,-1),10),
            ("LEFTPADDING",(0,0),(-1,-1),12),
            ("RIGHTPADDING",(0,0),(-1,-1),12),
            ("LINEAFTER",(0,0),(1,-1),1,GRIS_BORDE),
        ]))
        return t

    def seccion(titulo):
        story.append(Paragraph(titulo, sec))
        story.append(Spacer(1, 4))

    def gap():
        story.append(Spacer(1, 10))

    # ══ I. DATOS GENERALES ════════════════════════════════════════════════════
    seccion("I. DATOS GENERALES")
    story.append(fila(
        campo("Nombre del solicitante", data.get("nombre_solicitante","")),
        campo("Tipo de solicitante",    data.get("tipo_solicitante","PERSONA FÍSICA"))
    ))
    story.append(Spacer(1,3))
    story.append(fila3(
        campo("Tipo de identificación", data.get("tipo_identificacion","INE")),
        campo("Número de identificación", data.get("num_identificacion","")),
        campo("Fecha de nacimiento",    data.get("fecha_nacimiento",""))
    ))
    story.append(Spacer(1,3))
    story.append(fila3(
        campo("Teléfono del inquilino", data.get("telefono_inquilino","")),
        campo("Correo electrónico",     data.get("correo_inquilino","")),
        campo("Domicilio anterior",     data.get("domicilio_anterior",""), bold=False)
    ))
    story.append(Spacer(1,3))
    story.append(fila(
        campo("Tiempo vivido en domicilio anterior", data.get("tiempo_domicilio_anterior","")),
        campo("Dirección del inmueble a rentar",     data.get("direccion_inmueble",""), bold=False)
    ))
    story.append(Spacer(1,3))
    story.append(fila(
        campo("Monto de renta mensual", data.get("monto_renta","")),
        campo("Fecha de inicio del contrato", data.get("fecha_inicio",""))
    ))
    gap()

    # ══ II. PERFIL GENERAL ════════════════════════════════════════════════════
    seccion("II. PERFIL GENERAL DEL SOLICITANTE")
    story.append(Paragraph(data.get("perfil_general",
        "Los solicitantes fueron evaluados en cuanto a identidad, actividad principal "
        "y condiciones generales declaradas para el uso del inmueble."), body))
    gap()

    # ══ III. ACTIVIDAD E INGRESOS ═════════════════════════════════════════════
    seccion("III. ACTIVIDAD Y FUENTE DE INGRESOS")
    story.append(fila(
        campo("Actividad principal", data.get("actividad_principal","")),
        campo("Fuente de ingresos",  data.get("fuente_ingresos",""))
    ))
    story.append(Spacer(1,3))
    story.append(fila3(
        campo("Empresa / Empleador",     data.get("empresa","")),
        campo("Teléfono RRHH / Empresa", data.get("tel_empresa","")),
        campo("Ingreso mensual aproximado", data.get("ingreso_mensual",""))
    ))
    story.append(Spacer(1,3))
    story.append(fila(
        campo("Relación ingreso-renta", data.get("relacion_ingreso_renta","Adecuada")),
        campo("Comprobante de ingresos presentado", data.get("comprobante_ingresos","Sí"))
    ))
    gap()

    # ══ IV. USO Y OCUPANTES ═══════════════════════════════════════════════════
    seccion("IV. USO DEL INMUEBLE  /  V. OCUPANTES Y CONDICIONES")
    story.append(fila(
        campo("Uso declarado",    data.get("uso_declarado","HABITACIONAL")),
        campo("Descripción",      data.get("descripcion_uso",""), bold=False)
    ))
    story.append(Spacer(1,3))
    story.append(fila3(
        campo("Número de ocupantes", data.get("num_ocupantes","")),
        campo("Mascotas",            data.get("mascotas","No")),
        campo("Personal de servicio", data.get("personal_servicio","No"))
    ))
    gap()

    # ══ V. REFERENCIAS PERSONALES ════════════════════════════════════════════
    seccion("V. REFERENCIAS PERSONALES")
    for i in range(1, 3):
        ref_nombre   = data.get(f"ref{i}_nombre","")
        ref_telefono = data.get(f"ref{i}_telefono","")
        ref_relacion = data.get(f"ref{i}_relacion","")
        if ref_nombre:
            story.append(fila3(
                campo(f"Referencia {i} — Nombre",    ref_nombre),
                campo("Teléfono",                    ref_telefono),
                campo("Relación con el solicitante", ref_relacion)
            ))
            story.append(Spacer(1,3))
    gap()

    # ══ VI. ANTECEDENTES LEGALES ══════════════════════════════════════════════
    seccion("VI. ANTECEDENTES LEGALES — CONSULTA BUROMEXICO")
    resultado_legal = data.get("resultado_legal","Sin antecedentes")
    obs_legal = data.get("observaciones_legales","")

    if resultado_legal == "Sin antecedentes":
        bg_legal = VERDE_BG
        color_legal = VERDE
        icono_legal = "✓  SIN ANTECEDENTES LEGALES RELEVANTES"
    else:
        bg_legal = ROJO_BG
        color_legal = ROJO_TEXTO
        icono_legal = "⚠  CON ANTECEDENTES — VER OBSERVACIONES"

    legal_badge = Table([[
        Paragraph(icono_legal, S("lb", fontSize=11, fontName="Helvetica-Bold",
                                  textColor=color_legal, alignment=TA_CENTER, leading=15))
    ]], colWidths=[7.2*inch])
    legal_badge.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1), bg_legal),
        ("TOPPADDING",(0,0),(-1,-1),12),
        ("BOTTOMPADDING",(0,0),(-1,-1),12),
        ("ROUNDEDCORNERS",[8,8,8,8]),
        ("BOX",(0,0),(-1,-1),1.5, color_legal),
    ]))
    story.append(legal_badge)
    if obs_legal:
        story.append(Spacer(1,6))
        story.append(Paragraph(f"Observaciones: {obs_legal}", body))
    gap()

    # ══ VII. REVISIÓN GENERAL ════════════════════════════════════════════════
    seccion("VII. REFERENCIAS E HISTORIAL  /  VIII. REVISIÓN LEGAL")
    story.append(Paragraph(data.get("referencias",
        "Se revisaron referencias e historial de arrendamiento, no detectándose alertas relevantes."), body))
    story.append(Spacer(1,6))
    story.append(Paragraph(data.get("revision_legal",
        "Se realizó verificación de identidad y consulta de antecedentes jurídicos. "
        "No se detectaron impedimentos legales, inconsistencias relevantes ni riesgos jurídicos."), body))
    gap()

    # ══ VIII. CONCLUSIÓN ══════════════════════════════════════════════════════
    seccion("IX. CONCLUSIÓN Y RECOMENDACIÓN")
    story.append(Paragraph(data.get("conclusion",
        "Derivado de la investigación realizada, el perfil de los solicitantes resulta "
        "congruente con el inmueble y el monto de renta."), body))

    # Observaciones del analista
    obs_analista = data.get("observaciones_analista","")
    if obs_analista:
        story.append(Spacer(1,8))
        obs_t = Table([[
            [Paragraph("OBSERVACIONES DEL ANALISTA",
                S("oa_lbl", fontSize=8, fontName="Helvetica-Bold", textColor=AZUL, leading=10)),
             Spacer(1,4),
             Paragraph(obs_analista,
                S("oa_txt", fontSize=9.5, fontName="Helvetica", textColor=GRIS_MEDIO,
                  leading=14, alignment=TA_JUSTIFY))]
        ]], colWidths=[7.2*inch])
        obs_t.setStyle(TableStyle([
            ("BACKGROUND",(0,0),(-1,-1), AZUL_BG),
            ("TOPPADDING",(0,0),(-1,-1),12),
            ("BOTTOMPADDING",(0,0),(-1,-1),12),
            ("LEFTPADDING",(0,0),(-1,-1),14),
            ("RIGHTPADDING",(0,0),(-1,-1),14),
            ("ROUNDEDCORNERS",[8,8,8,8]),
            ("BOX",(0,0),(-1,-1),1.5, AZUL),
        ]))
        story.append(obs_t)
    story.append(Spacer(1,14))

    # ══ X. DICTAMEN FINAL ════════════════════════════════════════════════════
    seccion("X. DICTAMEN FINAL")
    story.append(Spacer(1,6))

    if dictamen == "APROBADO":
        badge_bg, badge_color, badge_txt = VERDE_BG, VERDE, "✓  APROBADO"
    elif dictamen == "APROBADO CON CONDICIONES":
        badge_bg, badge_color, badge_txt = AMARILLO_BG, HexColor("#854d0e"), "⚠  APROBADO CON CONDICIONES"
    else:
        badge_bg, badge_color, badge_txt = ROJO_BG, ROJO_TEXTO, "✗  NO APROBADO"

    condiciones_txt = data.get("condiciones","")
    badge_content = [Paragraph(badge_txt,
        S("badge", fontSize=20, fontName="Helvetica-Bold", textColor=badge_color,
          alignment=TA_CENTER, leading=26))]
    if condiciones_txt:
        badge_content.append(Spacer(1,4))
        badge_content.append(Paragraph(f"Condiciones: {condiciones_txt}",
            S("cond", fontSize=9, fontName="Helvetica", textColor=GRIS_CLARO,
              alignment=TA_CENTER, leading=12)))

    badge_t = Table([badge_content], colWidths=[7.2*inch])
    badge_t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1), badge_bg),
        ("TOPPADDING",(0,0),(-1,-1),20),
        ("BOTTOMPADDING",(0,0),(-1,-1),20),
        ("LEFTPADDING",(0,0),(-1,-1),20),
        ("RIGHTPADDING",(0,0),(-1,-1),20),
        ("ROUNDEDCORNERS",[10,10,10,10]),
        ("BOX",(0,0),(-1,-1),2.5, badge_color),
    ]))
    story.append(badge_t)
    story.append(Spacer(1,14))

    # ══ XI. DESLINDE ═════════════════════════════════════════════════════════
    story.append(LineDivider(color=GRIS_BORDE))
    story.append(Spacer(1,8))
    seccion("XI. DESLINDE LEGAL")
    story.append(Paragraph(
        "El presente reporte y dictamen se emite con base en la información proporcionada por el solicitante "
        "y bajo un estándar de diligencia razonable, sin constituir garantía de pago ni sustituir resoluciones judiciales.",
        S("dsl", fontSize=8.5, textColor=GRIS_CLARO, fontName="Helvetica", leading=13, alignment=TA_JUSTIFY)
    ))
    story.append(Spacer(1,14))

    # ══ XII. FIRMA ═══════════════════════════════════════════════════════════
    seccion("XII. FIRMA")
    story.append(Spacer(1,8))

    analista = data.get("analista","LIC. ZAYETZY MONTES LUNA")
    fecha    = data.get("fecha","")

    firma_t = Table([[
        [Paragraph("Analista responsable", lbl),
         Paragraph(analista, val),
         Spacer(1,30),
         LineDivider(color=GRIS_OSCURO, thickness=1, width=2.2*inch),
         Paragraph("Firma autorizada", lbl)],
        [Paragraph("Fecha de emisión", lbl),
         Paragraph(fecha, val),
         Spacer(1,30),
         LineDivider(color=GRIS_BORDE, thickness=1, width=2.2*inch),
         Paragraph(" ", lbl)],
        [Paragraph("Emitido por", lbl),
         Paragraph("EMPORIO INMOBILIARIO",
             S("ei", fontSize=10, fontName="Helvetica-Bold", textColor=ROJO, leading=13)),
         Paragraph("emporioinmobiliario.com.mx",
             S("url", fontSize=8, textColor=GRIS_CLARO, fontName="Helvetica", leading=11)),
         Paragraph("222 257 3237",
             S("tel", fontSize=8, textColor=GRIS_CLARO, fontName="Helvetica", leading=11))],
    ]], colWidths=[2.4*inch, 2.4*inch, 2.4*inch])
    firma_t.setStyle(TableStyle([
        ("VALIGN",(0,0),(-1,-1),"TOP"),
        ("TOPPADDING",(0,0),(-1,-1),0),
        ("BOTTOMPADDING",(0,0),(-1,-1),0),
        ("LEFTPADDING",(0,0),(-1,-1),0),
        ("RIGHTPADDING",(0,0),(-1,-1),16),
    ]))
    story.append(firma_t)
    story.append(Spacer(1,16))

    # Footer
    story.append(LineDivider(color=ROJO, thickness=2))
    story.append(Spacer(1,6))
    story.append(Paragraph(
        "EMPORIO INMOBILIARIO  ·  Reserva Territorial Atlixcayotl, San Andrés Cholula, Puebla  "
        "·  222 257 3237  ·  ventas@emporioinmobiliario.mx",
        S("ft", fontSize=7.5, textColor=GRIS_CLARO, fontName="Helvetica",
          alignment=TA_CENTER, leading=10)
    ))

    doc.build(story)
    return output_path


if __name__ == "__main__":
    import sys
    if len(sys.argv) >= 3:
        import json
        data_file = sys.argv[1]
        output_file = sys.argv[2]
        if len(sys.argv) >= 4:
            LOGO_PATH = sys.argv[3]
        with open(data_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        generate_dictamen_pdf(data, output_file)
        print(f"PDF generado: {output_file}")
        sys.exit(0)
    # Modo test local:
    data = {
        "folio": "E645",
        "fecha": "27/04/2026",
        "nombre_solicitante": "DE LA HOZ SUGASTI GUADALUPE Y VICTOR HUGO RUIZ DE LA HOZ",
        "tipo_solicitante": "PERSONA FÍSICA",
        "tipo_identificacion": "INE",
        "num_identificacion": "DESG850312MPLLGR09",
        "fecha_nacimiento": "12/03/1985",
        "telefono_inquilino": "222 345 6789",
        "correo_inquilino": "guadalupe.delahoz@gmail.com",
        "domicilio_anterior": "Av. Juárez 1204, Col. Centro, Puebla",
        "tiempo_domicilio_anterior": "3 años",
        "direccion_inmueble": "TORRE ADAMANT UNO, ATLIXCAYOTL 5413, ANGELES DEL SUR, SAN BERNARDINO TLAXCALANCINGO, PUEBLA",
        "monto_renta": "$16,000.00 (DIECISÉIS MIL 00/100 M.N)",
        "fecha_inicio": "01/05/2026",
        "perfil_general": "Los solicitantes fueron evaluados en cuanto a identidad, actividad principal y condiciones generales declaradas para el uso del inmueble.",
        "actividad_principal": "DOCTORA ANESTESIÓLOGA, HIJO ESTUDIANTE DE UNIVERSIDAD IBEROAMERICANA",
        "fuente_ingresos": "NÓMINA",
        "empresa": "HOSPITAL ANGELES PUEBLA",
        "tel_empresa": "222 303 6000",
        "ingreso_mensual": "$36,000.00 (TREINTA Y SEIS MIL PESOS 00/100 M.N)",
        "relacion_ingreso_renta": "Adecuada — ingresos 2.25x el monto de renta",
        "comprobante_ingresos": "Sí — 3 recibos de nómina presentados",
        "uso_declarado": "HABITACIONAL",
        "descripcion_uso": "DEPARTAMENTO PARA HIJO ESTUDIANTE",
        "num_ocupantes": "1 PERSONA",
        "mascotas": "No",
        "personal_servicio": "Sí — modalidad entrada y salida",
        "ref1_nombre": "DRA. PATRICIA VILLANUEVA RAMOS",
        "ref1_telefono": "222 456 7890",
        "ref1_relacion": "Colega de trabajo",
        "ref2_nombre": "LIC. ROBERTO GARZA TORRES",
        "ref2_telefono": "222 567 8901",
        "ref2_relacion": "Amigo personal",
        "resultado_legal": "Sin antecedentes",
        "observaciones_legales": "",
        "referencias": "Se revisaron referencias e historial de arrendamiento, no detectándose alertas relevantes para el propietario. Ambas referencias personales confirmaron buen comportamiento y solvencia del solicitante.",
        "revision_legal": "Se realizó verificación de identidad y consulta de antecedentes jurídicos en plataforma BuroMexico. No se detectaron impedimentos legales, inconsistencias relevantes ni riesgos jurídicos que comprometan la celebración del contrato de arrendamiento ni la emisión de la póliza jurídica.",
        "conclusion": "Derivado de la investigación realizada, el perfil de los solicitantes resulta congruente con el inmueble y el monto de renta. La relación ingreso-renta es adecuada y no se detectaron antecedentes negativos. Se recomienda proceder con la firma del contrato.",
        "observaciones_analista": "La solicitante cuenta con estabilidad laboral comprobada en institución hospitalaria de alto reconocimiento. El uso del inmueble es exclusivamente habitacional para estudiante universitario. Perfil de bajo riesgo.",
        "dictamen": "APROBADO",
        "condiciones": "",
        "analista": "LIC. ZAYETZY MONTES LUNA",
    }
    out = generate_dictamen_pdf(data, "/home/claude/dictamen_v3.pdf")
    print(f"PDF generado: {out}")
