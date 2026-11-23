import { concatenar, entero32, entero64, esHex, hexABytes, bytesAHex } from "./bytes.js";
import { huella } from "./huellas.js";

export const NIVELES = 17;
export const CASILLEROS = 2 ** NIVELES;

// Prefijos de dominio como en RFC 6962 (sec. 2.1): una hoja nunca puede hacerse pasar por un nodo.
const PREFIJO_HOJA = Uint8Array.of(0x00);
const PREFIJO_NODO = Uint8Array.of(0x01);
const PREFIJO_VACIO = Uint8Array.of(0x02);

const vaciosEnMemoria = new Map();

function codificarSumas(sumas) {
  return concatenar(...sumas.map(entero64));
}

function validarSumas(sumas, cantidadCategorias) {
  if (!Array.isArray(sumas) || sumas.length !== cantidadCategorias) {
    throw new Error(`Se esperaban ${cantidadCategorias} sumas`);
  }
  for (const suma of sumas) {
    if (!Number.isSafeInteger(suma) || suma < 0) {
      throw new Error("Las sumas deben ser enteros mayores o iguales a 0");
    }
  }
}

function validarCasillero(casillero) {
  if (!Number.isInteger(casillero) || casillero < 0 || casillero >= CASILLEROS) {
    throw new Error(`Casillero fuera del tablero: ${casillero}`);
  }
}

// Vacíos iguales por nivel, como en los árboles de Merkle dispersos (arquitectura, sec. 4):
// así solo se guardan los nodos que tienen al menos un acta.
export async function vaciosPorNivel(cantidadCategorias) {
  if (vaciosEnMemoria.has(cantidadCategorias)) {
    return vaciosEnMemoria.get(cantidadCategorias);
  }
  const ceros = new Array(cantidadCategorias).fill(0);
  const vacios = [{ huella: bytesAHex(await huella(PREFIJO_VACIO)), sumas: ceros }];
  for (let nivel = 1; nivel <= NIVELES; nivel++) {
    vacios.push(await nodoPadre(vacios[nivel - 1], vacios[nivel - 1]));
  }
  vaciosEnMemoria.set(cantidadCategorias, vacios);
  return vacios;
}

export async function hojaLlena(casillero, huellaActaHex, sumas) {
  validarCasillero(casillero);
  if (!esHex(huellaActaHex, 32)) {
    throw new Error("La huella del acta debe tener 64 caracteres hexadecimales");
  }
  validarSumas(sumas, sumas.length);
  const bytes = concatenar(PREFIJO_HOJA, entero32(casillero), hexABytes(huellaActaHex), codificarSumas(sumas));
  return { huella: bytesAHex(await huella(bytes)), sumas: [...sumas] };
}

// Cada nodo lleva las sumas de sus dos hijos por separado (Hu, Zhang y Guo, 2019, sec. 3.2, Solución 2):
// así un nodo no puede declarar un total que no salga de sus hijos.
export async function nodoPadre(izquierdo, derecho) {
  validarSumas(derecho.sumas, izquierdo.sumas.length);
  const bytes = concatenar(
    PREFIJO_NODO,
    hexABytes(izquierdo.huella),
    hexABytes(derecho.huella),
    codificarSumas(izquierdo.sumas),
    codificarSumas(derecho.sumas),
  );
  const sumas = izquierdo.sumas.map((suma, posicion) => suma + derecho.sumas[posicion]);
  validarSumas(sumas, sumas.length);
  return { huella: bytesAHex(await huella(bytes)), sumas };
}

export function posicionesHermanas(casillero) {
  validarCasillero(casillero);
  const posiciones = [];
  for (let nivel = 0; nivel < NIVELES; nivel++) {
    posiciones.push({ nivel, indice: (casillero >> nivel) ^ 1 });
  }
  return posiciones;
}

export function posicionesDelCamino(casillero) {
  validarCasillero(casillero);
  const posiciones = [];
  for (let nivel = 0; nivel <= NIVELES; nivel++) {
    posiciones.push({ nivel, indice: casillero >> nivel });
  }
  return posiciones;
}

export async function completarHermanos(hermanosGuardados, cantidadCategorias) {
  const vacios = await vaciosPorNivel(cantidadCategorias);
  return hermanosGuardados.map((hermano, nivel) => hermano ?? vacios[nivel]);
}

// Actualización por partes (arquitectura, sec. 3.2): solo se recalcula la rama del casillero, O(log n).
export async function actualizarCasillero({ casillero, hoja, hermanos }) {
  if (hermanos.length !== NIVELES) {
    throw new Error(`Se esperaban ${NIVELES} hermanos`);
  }
  const completos = await completarHermanos(hermanos, hoja.sumas.length);
  const nodos = [{ nivel: 0, indice: casillero, ...hoja }];
  let actual = hoja;
  for (let nivel = 0; nivel < NIVELES; nivel++) {
    const vaALaDerecha = ((casillero >> nivel) & 1) === 1;
    actual = vaALaDerecha ? await nodoPadre(completos[nivel], actual) : await nodoPadre(actual, completos[nivel]);
    nodos.push({ nivel: nivel + 1, indice: casillero >> (nivel + 1), ...actual });
  }
  return { nodos, raiz: actual };
}

export async function raizDesdeHoja({ casillero, hoja, hermanos }) {
  const { raiz } = await actualizarCasillero({ casillero, hoja, hermanos });
  return raiz;
}

export async function verificarInclusion({ casillero, huellaActa, sumas, hermanos, raiz }) {
  try {
    if (!Array.isArray(hermanos) || hermanos.length !== NIVELES || hermanos.some((hermano) => !hermano)) {
      return false;
    }
    const hoja = await hojaLlena(casillero, huellaActa, sumas);
    const calculada = await raizDesdeHoja({ casillero, hoja, hermanos });
    return calculada.huella === raiz.huella && calculada.sumas.every((suma, posicion) => suma === raiz.sumas[posicion]);
  } catch {
    return false;
  }
}

// Construcción completa en O(n log n) para el auditor y la segunda comprobación de las pruebas.
export async function construirTablero(hojas, cantidadCategorias) {
  const vacios = await vaciosPorNivel(cantidadCategorias);
  const niveles = [new Map()];
  for (const { casillero, huellaActa, sumas } of hojas) {
    validarSumas(sumas, cantidadCategorias);
    if (niveles[0].has(casillero)) {
      throw new Error(`Casillero repetido: ${casillero}`);
    }
    niveles[0].set(casillero, await hojaLlena(casillero, huellaActa, sumas));
  }
  for (let nivel = 0; nivel < NIVELES; nivel++) {
    const superior = new Map();
    const padres = [...new Set([...niveles[nivel].keys()].map((indice) => indice >> 1))].sort((primero, segundo) => primero - segundo);
    for (const padre of padres) {
      const izquierdo = niveles[nivel].get(padre * 2) ?? vacios[nivel];
      const derecho = niveles[nivel].get(padre * 2 + 1) ?? vacios[nivel];
      superior.set(padre, await nodoPadre(izquierdo, derecho));
    }
    niveles.push(superior);
  }
  return {
    niveles,
    raiz: niveles[NIVELES].get(0) ?? vacios[NIVELES],
    nodo(nivel, indice) {
      return niveles[nivel].get(indice) ?? null;
    },
  };
}
