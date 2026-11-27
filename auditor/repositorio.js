import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonico } from "../nucleo/index.js";

export const DIRECCION_API = "https://unicom-api.myk-unicom.workers.dev";

export function nombreArchivoRaiz(raiz) {
  const numero = String(raiz.contenido.numero).padStart(4, "0");
  return raiz.contenido.tipo === "genesis" ? `${numero}-genesis.json` : `${numero}.json`;
}

// El archivo es el JSON canónico del documento firmado completo: así su SHA-256, que es lo que
// OpenTimestamps ancla, no depende de espacios ni del orden de las claves.
export function bytesDeRaiz(raiz) {
  return new TextEncoder().encode(canonico(raiz));
}

export function leerRaicesDelRepositorio(carpeta) {
  if (!existsSync(carpeta)) {
    return [];
  }
  return readdirSync(carpeta)
    .filter((nombre) => /^\d{4,}(-genesis)?\.json$/.test(nombre))
    .sort()
    .map((nombre) => JSON.parse(readFileSync(join(carpeta, nombre), "utf8")));
}

export function leerJsonSiExiste(ruta, porDefecto) {
  return existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : porDefecto;
}

export function escribirJson(ruta, datos) {
  mkdirSync(join(ruta, ".."), { recursive: true });
  writeFileSync(ruta, JSON.stringify(datos, null, 2) + "\n");
}

export function commitActual(carpetaRepositorio) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: carpetaRepositorio, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// Revisión 7 del auditor: la historia nueva debe continuar a la que ya tenía (nadie hizo force-push).
export function historiaContinua(carpetaRepositorio, commitAnterior) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commitAnterior, "HEAD"], { cwd: carpetaRepositorio, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function argumentos(lista) {
  const resultado = {};
  for (let posicion = 0; posicion < lista.length; posicion++) {
    if (lista[posicion].startsWith("--")) {
      resultado[lista[posicion].slice(2)] = lista[posicion + 1];
      posicion += 1;
    }
  }
  return resultado;
}
