import { esHex } from "./bytes.js";
import { CASILLEROS } from "./tablero.js";
import { huellaDeObjeto } from "./huellas.js";
import { verificarFirmaDeHuella } from "./firmas.js";

// El orden de esta lista fija el orden de las sumas dentro del árbol: cambiarlo cambia todas las raíces.
export const CATEGORIAS = ["P01", "P02", "blancos", "nulos", "impugnados"];

export const NOMBRES_CATEGORIAS = {
  P01: "Partido Sol",
  P02: "Partido Río",
  blancos: "Votos en blanco",
  nulos: "Votos nulos",
  impugnados: "Votos impugnados",
};

export const ROLES = ["miembro", "personero"];

const CAMPOS_PAQUETE = [
  "fecha_hora_declarada",
  "foto_sha256",
  "mesa",
  "personeros_presentes",
  "precinto_numero",
  "precinto_sha256",
  "reemplaza_a",
  "votos",
];

const PATRON_MESA = /^\d{6}$/;
const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;
const PATRON_PRECINTO = /^[A-Za-z0-9-]{1,32}$/;

export function casilleroDeMesa(mesa) {
  if (typeof mesa !== "string" || !PATRON_MESA.test(mesa)) {
    throw new Error(`Número de mesa inválido: ${mesa}`);
  }
  const casillero = Number(mesa);
  // Pendiente del plan (Paso 8): confirmar con la ONPE que sus números de mesa caben en 2^17 casilleros.
  if (casillero >= CASILLEROS) {
    throw new Error(`La mesa ${mesa} no cabe en los ${CASILLEROS} casilleros del tablero`);
  }
  return casillero;
}

export function sumasDeVotos(votos) {
  return CATEGORIAS.map((categoria) => votos[categoria]);
}

export function totalesConNombre(sumas) {
  const totales = {};
  CATEGORIAS.forEach((categoria, posicion) => {
    totales[categoria] = sumas[posicion];
  });
  return totales;
}

export function validarPaquete(paquete) {
  const errores = [];
  if (!paquete || typeof paquete !== "object" || Array.isArray(paquete)) {
    return ["El paquete debe ser un objeto JSON"];
  }
  const camposRecibidos = Object.keys(paquete).sort();
  const faltantes = CAMPOS_PAQUETE.filter((campo) => !camposRecibidos.includes(campo));
  const sobrantes = camposRecibidos.filter((campo) => !CAMPOS_PAQUETE.includes(campo));
  if (faltantes.length > 0) {
    errores.push(`Faltan campos: ${faltantes.join(", ")}`);
  }
  if (sobrantes.length > 0) {
    errores.push(`Campos no permitidos: ${sobrantes.join(", ")}`);
  }
  if (!PATRON_MESA.test(String(paquete.mesa))) {
    errores.push("mesa debe tener 6 dígitos, por ejemplo \"045123\"");
  } else if (Number(paquete.mesa) >= CASILLEROS) {
    errores.push(`mesa ${paquete.mesa} no cabe en el tablero`);
  }
  errores.push(...validarVotos(paquete.votos));
  if (!esHex(paquete.foto_sha256, 32)) {
    errores.push("foto_sha256 debe ser la huella SHA-256 de la foto en hexadecimal (64 caracteres)");
  }
  if (paquete.precinto_sha256 !== null && !esHex(paquete.precinto_sha256, 32)) {
    errores.push("precinto_sha256 debe ser null o una huella SHA-256 en hexadecimal");
  }
  if (paquete.precinto_numero !== null && !PATRON_PRECINTO.test(String(paquete.precinto_numero))) {
    errores.push("precinto_numero debe ser null o un código de 1 a 32 letras, dígitos o guiones");
  }
  if (typeof paquete.fecha_hora_declarada !== "string" || !PATRON_FECHA.test(paquete.fecha_hora_declarada)) {
    errores.push("fecha_hora_declarada debe ser una fecha ISO 8601, por ejemplo \"2026-11-27T16:05:00-05:00\"");
  }
  if (typeof paquete.personeros_presentes !== "boolean") {
    errores.push("personeros_presentes debe ser true o false");
  }
  if (paquete.reemplaza_a !== null && !esHex(paquete.reemplaza_a, 32)) {
    errores.push("reemplaza_a debe ser null o la huella del acta que se corrige");
  }
  return errores;
}

function validarVotos(votos) {
  if (!votos || typeof votos !== "object" || Array.isArray(votos)) {
    return ["votos debe ser un objeto con una cantidad por categoría"];
  }
  const errores = [];
  const claves = Object.keys(votos);
  const faltantes = CATEGORIAS.filter((categoria) => !claves.includes(categoria));
  const sobrantes = claves.filter((clave) => !CATEGORIAS.includes(clave));
  if (faltantes.length > 0) {
    errores.push(`votos: faltan categorías ${faltantes.join(", ")}`);
  }
  if (sobrantes.length > 0) {
    errores.push(`votos: categorías desconocidas ${sobrantes.join(", ")}`);
  }
  for (const categoria of CATEGORIAS) {
    if (claves.includes(categoria) && !(Number.isSafeInteger(votos[categoria]) && votos[categoria] >= 0)) {
      errores.push(`votos.${categoria} debe ser un entero mayor o igual a 0`);
    }
  }
  return errores;
}

export async function huellaActa(paquete) {
  return huellaDeObjeto(paquete);
}

export function validarFirmasDeActa(firmas, huellaDelActa) {
  if (!Array.isArray(firmas) || firmas.length === 0 || firmas.length > 5) {
    return ["firmas debe ser una lista de 1 a 5 firmas"];
  }
  const errores = [];
  const llavesVistas = new Set();
  firmas.forEach((firma, posicion) => {
    if (!firma || !ROLES.includes(firma.rol)) {
      errores.push(`firmas[${posicion}].rol debe ser "miembro" o "personero"`);
      return;
    }
    if (!esHex(firma.llave_publica, 32)) {
      errores.push(`firmas[${posicion}].llave_publica debe tener 64 caracteres hexadecimales`);
      return;
    }
    if (llavesVistas.has(firma.llave_publica)) {
      errores.push(`firmas[${posicion}]: la misma llave firmó dos veces`);
      return;
    }
    llavesVistas.add(firma.llave_publica);
    if (!verificarFirmaDeHuella(firma.firma, huellaDelActa, firma.llave_publica)) {
      errores.push(`firmas[${posicion}]: la firma no corresponde a este paquete y esta llave`);
    }
  });
  if (!firmas.some((firma) => firma && firma.rol === "miembro")) {
    errores.push("Falta la firma de un miembro de mesa");
  }
  return errores;
}
