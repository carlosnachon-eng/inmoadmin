import { validateDemoEnvironment } from "./lib/demo-environment-guard.mjs";

validateDemoEnvironment(process.env, {
  operation: "validación previa P0.5",
  writeCapable: false,
});

console.log("Destino demo validado. No se abrió ninguna conexión.");
