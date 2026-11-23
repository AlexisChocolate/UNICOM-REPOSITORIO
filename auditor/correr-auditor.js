// Auditor continuo (Paso 9). Lo corre GitHub Actions (nuestro) o la laptop de un partido (independiente).
//
//   node auditor/correr-auditor.js [--api URL] [--repositorio .] [--nombre "auditor de GitHub Actions"]
//
// Guarda su estado en auditor/estado/, publica lo que vio en auditor/publicado/ultima-vista.json
// y una copia de cada árbol anclado en auditor/arboles/. Termina con código 1 si encontró inconsistencias.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { auditar } from "./auditor.js";
import { fuenteHttp } from "./fuentes.js";
import {
  DIRECCION_API,
  argumentos,
  commitActual,
  escribirJson,
  historiaContinua,
  leerJsonSiExiste,
  leerRaicesDelRepositorio,
  nombreArchivoRaiz,
} from "./repositorio.js";

async function vistasDeOtrosAuditores(direcciones) {
  const vistas = [];
  for (const direccion of direcciones) {
    try {
      const respuesta = await fetch(direccion);
      if (respuesta.ok) {
        vistas.push(await respuesta.json());
      }
    } catch {
      continue;
    }
  }
  return vistas;
}

async function principal() {
  const opciones = argumentos(process.argv.slice(2));
  const repositorio = opciones.repositorio ?? ".";
  const rutaEstado = join(repositorio, "auditor", "estado", "estado.json");
  const estadoPrevio = leerJsonSiExiste(rutaEstado, {});
  const raicesDelRepositorio = leerRaicesDelRepositorio(join(repositorio, "raices"));
  const otros = leerJsonSiExiste(join(repositorio, "auditor", "otros-auditores.json"), { direcciones: [] });

  const informe = await auditar({
    fuente: fuenteHttp(opciones.api ?? DIRECCION_API),
    estadoPrevio,
    raicesDelRepositorio,
    vistasDeOtros: await vistasDeOtrosAuditores(otros.direcciones),
  });

  const commit = commitActual(repositorio);
  if (estadoPrevio.commit && commit && !historiaContinua(repositorio, estadoPrevio.commit)) {
    informe.alertas.push({ revision: 7, mensaje: `La historia del repositorio ya no contiene el commit ${estadoPrevio.commit}: alguien la reescribió` });
  }

  for (const arbol of informe.arboles) {
    const rutaOts = join(repositorio, "raices", `${nombreArchivoRaiz({ contenido: { numero: arbol.numero, tipo: "raiz" } })}.ots`);
    const rutaArbol = join(repositorio, "auditor", "arboles", `raiz-${String(arbol.numero).padStart(4, "0")}.json`);
    if (existsSync(rutaOts) && !existsSync(rutaArbol)) {
      escribirJson(rutaArbol, arbol);
    }
  }

  const fecha = new Date().toISOString();
  escribirJson(rutaEstado, { ...informe.nuevoEstado, commit: commit ?? estadoPrevio.commit ?? null, fecha });
  escribirJson(join(repositorio, "auditor", "publicado", "ultima-vista.json"), {
    auditor: opciones.nombre ?? "auditor de UNICOM",
    fecha,
    raiz: informe.nuevoEstado.ultima_raiz,
    renglones: informe.nuevoEstado.ultimo_renglon,
  });
  escribirJson(join(repositorio, "auditor", "publicado", "informe.json"), {
    fecha,
    alertas: informe.alertas,
    avisos: informe.avisos,
    resumen: informe.resumen,
  });

  console.log(`Fuente: ${informe.resumen.fuente}`);
  console.log(`Renglones: ${informe.resumen.renglones} · actas vigentes: ${informe.resumen.actas} · raíces: ${informe.resumen.raices}`);
  console.log(`Totales recalculados: ${JSON.stringify(informe.resumen.totales)}`);
  for (const aviso of informe.avisos) {
    console.log(`Aviso (revisión ${aviso.revision}): ${aviso.mensaje}`);
  }
  if (informe.alertas.length === 0) {
    console.log("Sin inconsistencias.");
    return;
  }
  for (const alerta of informe.alertas) {
    console.log(`ALERTA (revisión ${alerta.revision}): ${alerta.mensaje}`);
  }
  process.exitCode = 1;
}

principal().catch((error) => {
  console.error(`Falló: ${error.message}`);
  process.exitCode = 2;
});
