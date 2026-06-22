#!/usr/bin/env python3
"""
Genera una ficha comercial en PDF de una propiedad, para enviar a prospectos
por WhatsApp o correo. Usa SimpleDocTemplate de ReportLab para que el
contenido fluya automáticamente entre páginas si la descripción es larga,
en vez de calcular posiciones fijas a mano.

Deliberadamente usa solo la librería estándar de Python (urllib) para
descargar imágenes, sin depender de paquetes externos como `requests`,
que pueden no estar garantizados en el entorno serverless.

Uso: python3 generate_ficha_propiedad.py <data.json> <output.pdf> <logo_path>
"""
import sys
import json
import os
import io
import urllib.request
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor
from reportlab.lib.units import inch
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                 TableStyle, Image, Flowable, KeepTogether)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY

# ── Colores de marca ─────────────────────────────────────────────────────────
ROJO        = HexColor("#C8102E")
GRIS_OSCURO = HexColor("#1a1a2e")
GRIS_MEDIO  = HexColor("#4a4a5a")
GRIS_CLARO  = HexColor("#6b7280")
GRIS_BG     = HexColor("#f5f5f6")
GRIS_BORDE  = HexColor("#e5e7eb")
VERDE_TXT   = HexColor("#065f46")
VERDE_BG    = HexColor("#f0fdf4")

PAGE_W, PAGE_H = letter
MARGIN = 0.62 * inch
CONTENT_W = PAGE_W - 2 * MARGIN

LEYENDA_PROFECO = (
    "La información presentada en este documento es de carácter informativo y referencial; no constituye una "
    "oferta vinculante ni sustituye la información que se proporcione en el contrato correspondiente. En "
    "cumplimiento de la normatividad de la Procuraduría Federal del Consumidor (PROFECO) en materia de "
    "publicidad inmobiliaria, Emporio Inmobiliario se compromete a que la información aquí mostrada sea "
    "veraz y comprobable."
)


def S(name, **kwargs):
    return ParagraphStyle(name, **kwargs)


def fmt_precio(n):
    try:
        return f"${float(n):,.0f}"
    except (TypeError, ValueError):
        return ""


class LineDivider(Flowable):
    def __init__(self, color=None, thickness=1, width=None):
        Flowable.__init__(self)
        self.color = color or GRIS_BORDE
        self.thickness = thickness
        self.width_val = width
        self.height = thickness + 4

    def draw(self):
        w = self.width_val or CONTENT_W
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, self.thickness / 2, w, self.thickness / 2)


def descargar_imagen(url, timeout=10):
    """Descarga una imagen y la regresa como objeto Image de reportlab.
    Usa solo urllib (librería estándar), sin dependencias externas.
    Si falla, regresa None — nunca debe tronar la generación del PDF."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; EmporioBot/1.0)"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        return Image(io.BytesIO(data))
    except Exception as e:
        print(f"[generate_ficha_propiedad] no se pudo descargar imagen {url}: {e}", file=sys.stderr)
        return None


def escalar_imagen(img, max_w, max_h):
    ratio = min(max_w / img.imageWidth, max_h / img.imageHeight)
    img.drawWidth = img.imageWidth * ratio
    img.drawHeight = img.imageHeight * ratio
    return img


def url_de_foto(foto):
    """Las fotos pueden venir como string directo o como objeto {url: ...}."""
    if isinstance(foto, str):
        return foto
    if isinstance(foto, dict):
        return foto.get("url")
    return None


def generate_ficha_pdf(data: dict, output_path: str, logo_path: str):
    doc = SimpleDocTemplate(
        output_path, pagesize=letter,
        rightMargin=MARGIN, leftMargin=MARGIN,
        topMargin=0.55 * inch, bottomMargin=0.7 * inch,
    )

    lbl    = S("lbl", fontSize=7.5, textColor=GRIS_CLARO,  fontName="Helvetica",      leading=10)
    val    = S("val", fontSize=12,  textColor=GRIS_OSCURO, fontName="Helvetica-Bold", leading=15)
    sec    = S("sec", fontSize=10.5, textColor=ROJO,        fontName="Helvetica-Bold", leading=13, spaceAfter=6)
    body   = S("bod", fontSize=10,  textColor=GRIS_MEDIO,   fontName="Helvetica",      leading=15, spaceAfter=8, alignment=TA_JUSTIFY)
    chip   = S("chp", fontSize=9.5, textColor=VERDE_TXT,    fontName="Helvetica-Bold", leading=18)
    titulo = S("tit", fontSize=16,  textColor=GRIS_OSCURO,  fontName="Helvetica-Bold", leading=20, spaceAfter=4)
    dirSt  = S("dir", fontSize=10,  textColor=GRIS_CLARO,   fontName="Helvetica",      leading=13, spaceAfter=10)
    precio = S("pre", fontSize=25,  textColor=ROJO,         fontName="Helvetica-Bold", leading=30, spaceAfter=14)

    story = []

    # ══ HEADER: logo a la izquierda, operación/exclusiva a la derecha ════════
    logo_w, logo_h = 1.75 * inch, 0.92 * inch
    if os.path.exists(logo_path):
        try:
            logo_cell = Image(logo_path)
            escalar_imagen(logo_cell, logo_w, logo_h)
            logo_cell.hAlign = "LEFT"
        except Exception:
            logo_cell = None
    else:
        logo_cell = descargar_imagen("https://www.emporioinmobiliario.com.mx/logo.png")
        if logo_cell:
            escalar_imagen(logo_cell, logo_w, logo_h)
            logo_cell.hAlign = "LEFT"

    if not logo_cell:
        logo_cell = Paragraph('<font color="#C8102E" size="20"><b>EMPORIO</b></font>',
                               S("lg", alignment=TA_LEFT, leading=24))

    operacion_label = "EN VENTA" if data.get("operacion") == "sale" else "EN RENTA"
    op_lines = [Paragraph(operacion_label, S("op", fontSize=12, textColor=ROJO, fontName="Helvetica-Bold", alignment=TA_RIGHT, leading=15))]
    if data.get("es_exclusiva"):
        op_lines.append(Spacer(1, 2))
        op_lines.append(Paragraph("EXCLUSIVA", S("ex", fontSize=9, textColor=GRIS_OSCURO, fontName="Helvetica-Bold", alignment=TA_RIGHT, leading=11)))

    header_table = Table([[logo_cell, op_lines]], colWidths=[CONTENT_W * 0.5, CONTENT_W * 0.5])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 10))
    story.append(LineDivider(color=ROJO, thickness=2.5))
    story.append(Spacer(1, 16))

    # ══ TÍTULO, DIRECCIÓN, PRECIO ═════════════════════════════════════════════
    story.append(Paragraph(data.get("titulo") or "Propiedad", titulo))
    direccion = ", ".join([x for x in [data.get("direccion"), data.get("colonia"), data.get("ciudad"), data.get("estado")] if x])
    if direccion:
        story.append(Paragraph(direccion, dirSt))

    precio_valor = fmt_precio(data.get("precio"))
    if precio_valor:
        story.append(Paragraph(f"{precio_valor} MXN", precio))

    # ══ FOTOS (hasta 3, centradas y con tamaño uniforme) ═════════════════════
    fotos = [url_de_foto(f) for f in (data.get("fotos") or [])]
    fotos = [u for u in fotos if u][:3]
    if fotos:
        n = len(fotos)
        gap = 0.1 * inch
        foto_w = (CONTENT_W - gap * (n - 1)) / n
        foto_h = foto_w * 0.72
        celdas = []
        for url in fotos:
            img = descargar_imagen(url)
            if img:
                escalar_imagen(img, foto_w, foto_h)
                celdas.append(img)
            else:
                celdas.append(Paragraph("", body))
        foto_table = Table([celdas], colWidths=[foto_w] * n)
        foto_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, -1), gap),
            ("RIGHTPADDING", (-1, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(foto_table)
        story.append(Spacer(1, 16))

    # ══ DATOS DESTACADOS (caja gris con chips) ════════════════════════════════
    destacados = []
    if data.get("tipo"):
        destacados.append(("TIPO", str(data["tipo"])))
    if data.get("recamaras"):
        destacados.append(("RECÁMARAS", str(data["recamaras"])))
    if data.get("banos"):
        destacados.append(("BAÑOS", str(data["banos"])))
    if data.get("estacionamientos"):
        destacados.append(("ESTACIONAMIENTO", str(data["estacionamientos"])))
    if data.get("m2_construccion"):
        destacados.append(("M2 CONSTR.", str(data["m2_construccion"])))
    if data.get("m2_terreno"):
        destacados.append(("M2 TERRENO", str(data["m2_terreno"])))

    if destacados:
        celdas = []
        for label, valor in destacados[:6]:
            celdas.append([Paragraph(label, lbl), Spacer(1, 3), Paragraph(valor, val)])
        col_w = CONTENT_W / len(celdas)
        dest_table = Table([celdas], colWidths=[col_w] * len(celdas))
        dest_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BACKGROUND", (0, 0), (-1, -1), GRIS_BG),
            ("TOPPADDING", (0, 0), (-1, -1), 12),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("ROUNDEDCORNERS", [6, 6, 6, 6]),
        ]))
        story.append(dest_table)
        story.append(Spacer(1, 18))

    # ══ DESCRIPCIÓN ═══════════════════════════════════════════════════════════
    if data.get("descripcion"):
        story.append(Paragraph("DESCRIPCIÓN", sec))
        # Párrafos separados por salto de línea se respetan como párrafos
        # independientes, en vez de un solo bloque de texto plano.
        for parrafo in [p.strip() for p in data["descripcion"].split("\n") if p.strip()]:
            story.append(Paragraph(parrafo, body))
        story.append(Spacer(1, 6))

    # ══ AMENIDADES ════════════════════════════════════════════════════════════
    amenidades = data.get("amenidades") or []
    if amenidades:
        story.append(Paragraph("AMENIDADES", sec))
        texto_amenidades = "    ".join([f"●  {a}" for a in amenidades])
        story.append(Paragraph(texto_amenidades, chip))
        story.append(Spacer(1, 14))

    # ══ CRÉDITOS ACEPTADOS (solo venta) ═══════════════════════════════════════
    creditos = data.get("creditos_aceptados") or []
    if creditos and data.get("operacion") == "sale":
        story.append(Paragraph("CRÉDITOS ACEPTADOS", sec))
        story.append(Paragraph("    ".join(creditos), body))
        story.append(Spacer(1, 10))

    # ══ FOOTER: fluye después del contenido, nunca se encima ═════════════════
    story.append(Spacer(1, 16))
    story.append(LineDivider(color=GRIS_BORDE))
    story.append(Spacer(1, 12))

    contacto = data.get("contacto_nombre") or "Emporio Inmobiliario"
    tel = data.get("contacto_telefono") or ""
    pie_texto = f"<b>{contacto}</b>" + (f" &middot; {tel}" if tel else "")
    story.append(Paragraph(pie_texto, S("pie", fontSize=10, textColor=GRIS_OSCURO, fontName="Helvetica", alignment=TA_CENTER, leading=13, spaceAfter=8)))
    story.append(Paragraph(
        LEYENDA_PROFECO,
        S("legal", fontSize=7, textColor=GRIS_CLARO, fontName="Helvetica", alignment=TA_CENTER, leading=9.5)
    ))

    doc.build(story)


if __name__ == "__main__":
    data_path, output_path, logo_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(data_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    generate_ficha_pdf(data, output_path, logo_path)
