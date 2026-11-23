// El "periódico" (Paso 9): copia al repositorio las raíces firmadas que publicó el servidor.
// Antes comprueba que la cadena sea válida y que el servidor no haya cambiado ninguna raíz ya publicada.
//
//   node auditor/publicar-raices.js [--api URL] [--carpeta raices]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verificarCadenaRaices } from "../nucleo/index.js";
import { fuenteHttp } from "./fuentes.js";
import { DIRECCION_API, argumentos, bytesDeRaiz, leerRaicesDelRepositorio, nombreArchivoRaiz } from "./repositorio.js";

async function principal() {
  const opciones = argumentos(process.argv.slice(2));
  const carpeta = opciones.carpeta ?? "raices";
  const raices = await fuenteHttp(opciones.api ?? DIRECCION_API).raices();
  const publicadas = leerRaicesDelRepositorio(carpeta);

  for (const publicada of publicadas) {
    const delServidor = raices[publicada.contenido.numero];
    if (!delServidor || delServidor.huella !== publicada.huella) {
      throw new Error(`El servidor cambió la raíz n.º ${publicada.contenido.numero} que ya estaba publicada`);
    }
  }
  const llaveGenesis = publicadas[0]?.contenido?.llave_publica_servidor ?? null;
  const cadena = await verificarCadenaRaices(raices, llaveGenesis);
  if (!cadena.valida) {
    throw new Error(`La cadena de raíces del servidor no es válida (n.º ${cadena.numero}): ${cadena.motivo}`);
  }

  mkdirSync(carpeta, { recursive: true });
  const nuevas = [];
  for (const raiz of raices) {
    const ruta = join(carpeta, nombreArchivoRaiz(raiz));
    if (!existsSync(ruta)) {
      writeFileSync(ruta, bytesDeRaiz(raiz));
      nuevas.push(ruta);
    }
  }
  for (const ruta of nuevas) {
    console.log(ruta);
  }
}

principal().catch((error) => {
  console.error(`Falló: ${error.message}`);
  process.exitCode = 1;
});
