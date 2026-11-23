// Copia pública de las fotos (arquitectura, sec. 8): baja de la API las fotos nuevas, comprueba su huella
// y las guarda en fotos/ con su huella como nombre. Así el Worker no necesita permiso para escribir en GitHub.
//
//   node auditor/copiar-fotos.js [--api URL] [--carpeta fotos]
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { huellaHex } from "../nucleo/index.js";
import { DIRECCION_API, argumentos } from "./repositorio.js";

const EXTENSIONES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

async function principal() {
  const opciones = argumentos(process.argv.slice(2));
  const direccion = (opciones.api ?? DIRECCION_API).replace(/\/+$/, "");
  const carpeta = opciones.carpeta ?? "fotos";
  mkdirSync(carpeta, { recursive: true });
  const yaCopiadas = new Set(readdirSync(carpeta).map((nombre) => nombre.split(".")[0]));
  let desde = "";
  let copiadas = 0;
  for (;;) {
    const respuesta = await fetch(`${direccion}/fotos?desde=${encodeURIComponent(desde)}&limite=500`);
    const { fotos } = await respuesta.json();
    for (const foto of fotos) {
      if (yaCopiadas.has(foto.huella)) {
        continue;
      }
      const bytes = new Uint8Array(await (await fetch(`${direccion}/fotos/${foto.huella}`)).arrayBuffer());
      if ((await huellaHex(bytes)) !== foto.huella) {
        throw new Error(`La foto ${foto.huella} que entrega el servidor no tiene esa huella`);
      }
      const ruta = join(carpeta, foto.huella + (EXTENSIONES[foto.tipo] ?? ""));
      if (!existsSync(ruta)) {
        writeFileSync(ruta, bytes);
        yaCopiadas.add(foto.huella);
        copiadas += 1;
      }
    }
    if (fotos.length < 500) {
      break;
    }
    desde = fotos.at(-1).fecha;
  }
  console.log(`Fotos nuevas copiadas: ${copiadas}`);
}

principal().catch((error) => {
  console.error(`Falló: ${error.message}`);
  process.exitCode = 1;
});
