#!/usr/bin/env python3
"""
Genera una ficha comercial en PDF de una propiedad, para enviar a prospectos
por WhatsApp o correo. Recibe un JSON con los datos de la propiedad (ya
filtrados — sin gravamen, notas internas, ni otros datos sensibles) y un
output_path, y produce el PDF.

Uso: python3 generate_ficha_propiedad.py <data.json> <output.pdf> <logo_path>
"""
import sys
import json
import os
import io
import requests
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor
from reportlab.lib.units import inch
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                 TableStyle, Image, Flowable)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY

# ── Colores de marca ─────────────────────────────────────────────────────────
ROJO        = HexColor("#C8102E")
GRIS_OSCURO = HexColor("#1a1a2e")
GRIS_MEDIO  = HexColor("#4a4a5a")
GRIS_CLARO  = HexColor("#6b7280")
GRIS_BG     = HexColor("#f8f8fa")
GRIS_BORDE  = HexColor("#e5e7eb")
VERDE_BG    = HexColor("#f0fdf4")
VERDE_TXT   = HexColor("#065f46")

W, H = letter


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


def descargar_imagen(url, max_width=None, max_height=None):
    """Descarga una imagen desde una URL pública y la devuelve como objeto
    Image de reportlab. Si falla, devuelve None (no debe tronar el PDF)."""
    try:
        resp = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0 (compatible; EmporioBot/1.0)"})
        resp.raise_for_status()
        img_bytes = io.BytesIO(resp.content)
        img = Image(img_bytes)
        if max_width and max_height:
            ratio = min(max_width / img.imageWidth, max_height / img.imageHeight)
            img.drawWidth = img.imageWidth * ratio
            img.drawHeight = img.imageHeight * ratio
        elif max_width:
            ratio = max_width / img.imageWidth
            img.drawWidth = max_width
            img.drawHeight = img.imageHeight * ratio
        return img
    except Exception as e:
        print(f"[generate_ficha_propiedad] no se pudo descargar imagen {url}: {e}", file=sys.stderr)
        return None


def generate_ficha_pdf(data: dict, output_path: str, logo_path: str):
    doc = SimpleDocTemplate(
        output_path, pagesize=letter,
        rightMargin=0.55 * inch, leftMargin=0.55 * inch,
        topMargin=0.5 * inch, bottomMargin=0.55 * inch,
    )

    lbl  = S("lbl", fontSize=7,   textColor=GRIS_CLARO,  fontName="Helvetica",      spaceAfter=2, leading=9)
    val  = S("val", fontSize=11,  textColor=GRIS_OSCURO, fontName="Helvetica-Bold", spaceAfter=0, leading=14)
    sec  = S("sec", fontSize=10,  textColor=ROJO,         fontName="Helvetica-Bold", spaceAfter=6, leading=13)
    body = S("bod", fontSize=10,  textColor=GRIS_MEDIO,   fontName="Helvetica",      leading=15, spaceAfter=4, alignment=TA_JUSTIFY)
    chip = S("chp", fontSize=9,   textColor=VERDE_TXT,    fontName="Helvetica-Bold", leading=12)

    story = []

    # ══ HEADER ════════════════════════════════════════════════════════════════
    if os.path.exists(logo_path):
        try:
            logo_cell = Image(logo_path, width=1.9 * inch, height=1.05 * inch)
            logo_cell.hAlign = "LEFT"
        except Exception:
            logo_cell = None
    else:
        logo_cell = descargar_imagen("https://www.emporioinmobiliario.com.mx/logo.png", max_width=1.9 * inch, max_height=1.05 * inch)
        if logo_cell:
            logo_cell.hAlign = "LEFT"

    if not logo_cell:
        logo_cell = Paragraph('<font color="#C8102E" size="18"><b>EMPORIO</b></font>', S("lg", alignment=TA_LEFT, leading=22))

    operacion_label = "EN VENTA" if data.get("operacion") == "sale" else "EN RENTA"
    op_cell = [
        Paragraph(operacion_label, S("op", fontSize=11, textColor=ROJO, fontName="Helvetica-Bold", alignment=TA_RIGHT, leading=14)),
    ]
    if data.get("es_exclusiva"):
        op_cell.append(Paragraph("EXCLUSIVA", S("ex", fontSize=9, textColor=GRIS_OSCURO, fontName="Helvetica-Bold", alignment=TA_RIGHT, leading=12)))

    ht = Table([[logo_cell, op_cell]], colWidths=[3.5 * inch, 3.6 * inch])
    ht.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (1, 0), (1, 0), "RIGHT")]))
    story.append(ht)
    story.append(Spacer(1, 8))
    story.append(LineDivider(color=ROJO, thickness=3))
    story.append(Spacer(1, 14))

    # ══ TÍTULO Y PRECIO ═══════════════════════════════════════════════════════
    story.append(Paragraph(data.get("titulo", "Propiedad"), S("tit", fontSize=16, textColor=GRIS_OSCURO, fontName="Helvetica-Bold", leading=20, spaceAfter=2)))
    direccion = ", ".join([x for x in [data.get("direccion"), data.get("colonia"), data.get("ciudad"), data.get("estado")] if x])
    if direccion:
        story.append(Paragraph(direccion, S("dir", fontSize=10, textColor=GRIS_CLARO, fontName="Helvetica", leading=13, spaceAfter=8)))

    precio = data.get("precio")
    if precio:
        precio_fmt = f"${precio:,.0f} MXN"
        story.append(Paragraph(precio_fmt, S("precio", fontSize=24, textColor=ROJO, fontName="Helvetica-Bold", leading=28, spaceAfter=10)))

    story.append(Spacer(1, 4))

    # ══ FOTOS (hasta 3 en una fila) ═══════════════════════════════════════════
    fotos = data.get("fotos") or []
    if fotos:
        imgs = []
        for url in fotos[:3]:
            img = descargar_imagen(url, max_width=2.3 * inch, max_height=1.7 * inch)
            if img:
                imgs.append(img)
        if imgs:
            while len(imgs) < 3:
                imgs.append(Paragraph("", body))
            ft = Table([imgs], colWidths=[2.4 * inch] * 3)
            ft.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (0, 0), (-1, -1), "CENTER")]))
            story.append(ft)
            story.append(Spacer(1, 14))

    # ══ DATOS DESTACADOS ══════════════════════════════════════════════════════
    destacados = []
    if data.get("tipo"):
        destacados.append(("TIPO", data["tipo"]))
    if data.get("recamaras"):
        destacados.append(("RECAMARAS", str(data["recamaras"])))
    if data.get("banos"):
        destacados.append(("BAÑOS", str(data["banos"])))
    if data.get("estacionamientos"):
        destacados.append(("ESTAC.", str(data["estacionamientos"])))
    if data.get("m2_construccion"):
        destacados.append(("M2 CONSTR.", str(data["m2_construccion"])))
    if data.get("m2_terreno"):
        destacados.append(("M2 TERRENO", str(data["m2_terreno"])))

    if destacados:
        celdas = []
        for label, valor in destacados[:6]:
            celdas.append([Paragraph(label, lbl), Paragraph(valor, val)])
        fila_destacados = Table([celdas], colWidths=[7.3 * inch / len(celdas)] * len(celdas))
        fila_destacados.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BACKGROUND", (0, 0), (-1, -1), GRIS_BG),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(fila_destacados)
        story.append(Spacer(1, 16))

    # ══ DESCRIPCIÓN ═══════════════════════════════════════════════════════════
    if data.get("descripcion"):
        story.append(Paragraph("DESCRIPCIÓN", sec))
        story.append(Paragraph(data["descripcion"], body))
        story.append(Spacer(1, 12))

    # ══ AMENIDADES ════════════════════════════════════════════════════════════
    amenidades = data.get("amenidades") or []
    if amenidades:
        story.append(Paragraph("AMENIDADES", sec))
        texto_amenidades = "    ".join([f"• {a}" for a in amenidades])
        story.append(Paragraph(texto_amenidades, chip))
        story.append(Spacer(1, 12))

    # ══ CRÉDITOS ACEPTADOS (solo venta) ═══════════════════════════════════════
    creditos = data.get("creditos_aceptados") or []
    if creditos and data.get("operacion") == "sale":
        story.append(Paragraph("CRÉDITOS ACEPTADOS", sec))
        story.append(Paragraph("    ".join(creditos), body))
        story.append(Spacer(1, 12))

    story.append(Spacer(1, 10))
    story.append(LineDivider(color=GRIS_BORDE))
    story.append(Spacer(1, 10))

    # ══ FOOTER / CONTACTO ═════════════════════════════════════════════════════
    contacto = data.get("contacto_nombre") or "Emporio Inmobiliario"
    tel = data.get("contacto_telefono") or ""
    pie = f"<b>{contacto}</b>" + (f" · {tel}" if tel else "")
    story.append(Paragraph(pie, S("pie", fontSize=10, textColor=GRIS_OSCURO, fontName="Helvetica", alignment=TA_CENTER, leading=13)))
    story.append(Paragraph(
        "La información presentada en este documento es de carácter informativo y referencial; no constituye una "
        "oferta vinculante ni sustituye la información que se proporcione en el contrato correspondiente. En "
        "cumplimiento de la normatividad de la Procuraduría Federal del Consumidor (PROFECO) en materia de "
        "publicidad inmobiliaria, Emporio Inmobiliario se compromete a que la información aquí mostrada sea "
        "veraz y comprobable.",
        S("legal", fontSize=7, textColor=GRIS_CLARO, fontName="Helvetica", alignment=TA_CENTER, leading=9, spaceBefore=8)
    ))

    doc.build(story)


if __name__ == "__main__":
    data_path, output_path, logo_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(data_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    generate_ficha_pdf(data, output_path, logo_path)
