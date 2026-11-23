// El detective (Paso 10) contra el servidor desplegado.
//
//   node auditor/detective.js --arbol auditor/arboles/raiz-0003.json [--api URL]
import { readFileSync } from "node:fs";
import { fuenteHttp } from "./fuentes.js";
import { investigar } from "./investigacion.js";
import { DIRECCION_API, argumentos } from "./repositorio.js";

async function principal() {
  const opciones = argumentos(process.argv.slice(2));
  if (!opciones.arbol) {
    throw new Error("Indique la copia del árbol anclado con --arbol");
  }
  const direccion = opciones.api ?? DIRECCION_API;
  const arbolAnclado = JSON.parse(readFileSync(opciones.arbol, "utf8"));
  const resultado = await investigar({ arbolAnclado, renglonesActuales: await fuenteHttp(direccion).cuaderno() });
  console.log(`Raíz anclada n.º ${arbolAnclado.numero}: ${resultado.raiz_anclada}`);
  console.log(`Raíz que resulta hoy del servidor: ${resultado.raiz_actual}`);
  console.log(`Comparaciones: ${resultado.comparaciones}`);
  if (resultado.hallazgos.length === 0) {
    console.log("Las actas ancladas siguen iguales en el servidor.");
    return;
  }
  for (const hallazgo of resultado.hallazgos) {
    console.log(`Casillero ${hallazgo.casillero}: ${hallazgo.veredicto}. ${hallazgo.detalle}`);
    if (hallazgo.foto_sha256) {
      console.log(`  Foto sellada: ${direccion}/fotos/${hallazgo.foto_sha256} (o cualquier copia con esa huella)`);
    }
  }
  process.exitCode = 1;
}

principal().catch((error) => {
  console.error(`Falló: ${error.message}`);
  process.exitCode = 2;
});
