import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const data = req.body;
  if (!data.nombre_solicitante) {
    return res.status(400).json({ error: "Faltan datos requeridos" });
  }

  // Archivo temporal para los datos y el PDF output
  const tmpDir   = os.tmpdir();
  const dataFile = path.join(tmpDir, `dictamen_data_${Date.now()}.json`);
  const pdfFile  = path.join(tmpDir, `dictamen_${Date.now()}.pdf`);
  const pyScript = path.join(process.cwd(), "scripts", "generate_dictamen.py");
  const logoPath = path.join(process.cwd(), "public", "logo.png");

  try {
    // Guardar datos como JSON temporal
    fs.writeFileSync(dataFile, JSON.stringify(data));

    // Correr el script Python
    execSync(`python3 "${pyScript}" "${dataFile}" "${pdfFile}" "${logoPath}"`, {
      timeout: 30000,
      env: { ...process.env },
    });

    // Leer el PDF generado
    if (!fs.existsSync(pdfFile)) {
      throw new Error("El PDF no fue generado");
    }

    const pdfBuffer = fs.readFileSync(pdfFile);

    // Limpiar archivos temporales
    fs.unlinkSync(dataFile);
    fs.unlinkSync(pdfFile);

    // Responder con el PDF
    const filename = `Dictamen_${data.folio || "nuevo"}_${(data.nombre_solicitante || "").split(" ")[0]}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.status(200).send(pdfBuffer);

  } catch (error) {
    // Limpiar en caso de error
    if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);
    if (fs.existsSync(pdfFile))  fs.unlinkSync(pdfFile);
    console.error("Error generando dictamen:", error.message);
    return res.status(500).json({ error: "Error al generar el PDF: " + error.message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};
