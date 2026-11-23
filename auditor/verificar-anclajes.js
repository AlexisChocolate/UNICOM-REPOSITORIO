// Verifica cada raíz publicada en raices/ contra su sello .ots y la cadena de Bitcoin, sin nodo propio.
//
//   node auditor/verificar-anclajes.js [--carpeta raices]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { exploradorEsplora, verificarSello } from "./anclaje.js";
import { argumentos } from "./repositorio.js";

async function principal() {
  const carpeta = argumentos(process.argv.slice(2)).carpeta ?? "raices";
  const obtenerEncabezado = exploradorEsplora();
  const archivos = existsSync(carpeta) ? readdirSync(carpeta).filter((nombre) => nombre.endsWith(".json")).sort() : [];
  let invalidos = 0;
  for (const nombre of archivos) {
    const rutaOts = join(carpeta, `${nombre}.ots`);
    if (!existsSync(rutaOts)) {
      console.log(`${nombre}: sin sello todavía`);
      continue;
    }
    const resultado = await verificarSello({
      bytesArchivo: readFileSync(join(carpeta, nombre)),
      bytesOts: readFileSync(rutaOts),
      obtenerEncabezado,
    });
    if (resultado.estado === "anclado") {
      console.log(`${nombre}: anclado en el bloque ${resultado.altura} (${resultado.fecha_bloque})`);
    } else {
      console.log(`${nombre}: ${resultado.estado}, ${resultado.motivo}`);
    }
    if (resultado.estado === "invalido") {
      invalidos += 1;
    }
  }
  if (invalidos > 0) {
    process.exitCode = 1;
  }
}

principal().catch((error) => {
  console.error(`Falló: ${error.message}`);
  process.exitCode = 1;
});
