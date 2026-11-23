import { bls12_381 } from "@noble/curves/bls12-381.js";
import { bytesAHex, concatenar, entero64, esHex, hexABytes, textoABytes } from "./bytes.js";
import { huella, huellaHex } from "./huellas.js";

// Red quicknet de drand (consultada en https://api.drand.sh/<hash>/info el 22/11/2026):
// esquema bls-unchained-g1-rfc9380, firma en G1 (48 bytes) y llave pública en G2 (96 bytes).
export const DRAND_QUICKNET = {
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  llavePublica:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  periodoSegundos: 3,
  genesisSegundos: 1692803367,
  esquema: "bls-unchained-g1-rfc9380",
};

// En el esquema "unchained" el mensaje firmado es SHA-256 del número de ronda en 8 bytes big-endian,
// y la aleatoriedad publicada es SHA-256 de la firma.
export async function verificarRondaDrand({ round, signature, randomness }, llavePublica = DRAND_QUICKNET.llavePublica) {
  try {
    if (!Number.isSafeInteger(round) || round < 1 || !esHex(signature, 48)) {
      return false;
    }
    const mensaje = await huella(entero64(round));
    const firmaValida = bls12_381.shortSignatures.verify(
      hexABytes(signature),
      bls12_381.shortSignatures.hash(mensaje),
      hexABytes(llavePublica),
    );
    if (!firmaValida) {
      return false;
    }
    return randomness === undefined || randomness === (await huellaHex(hexABytes(signature)));
  } catch {
    return false;
  }
}

export function rondaDrandEnFecha(fecha, red = DRAND_QUICKNET) {
  const segundos = Math.floor(new Date(fecha).getTime() / 1000);
  return Math.floor((segundos - red.genesisSegundos) / red.periodoSegundos) + 1;
}

// El hash de un bloque de Bitcoin es el doble SHA-256 de su encabezado de 80 bytes, mostrado al revés.
export async function verificarEncabezadoBitcoin(encabezadoHex, hashBloque) {
  if (!esHex(encabezadoHex, 80) || !esHex(hashBloque, 32)) {
    return false;
  }
  const doble = await huella(await huella(hexABytes(encabezadoHex)));
  return bytesAHex(doble.reverse()) === hashBloque;
}

// Semilla = SHA-256(dados ‖ firma de drand de la ronda R ‖ hash del bloque H) (Paso 11, Carril B).
// El SHA-256 además "empareja" el azar del bloque, que no es uniforme (Bonneau, Clark y Goldfeder, 2015).
export async function semillaSorteo({ dados, firmaDrand, hashBloque }) {
  if (typeof dados !== "string" || !/^[1-6]{10,}$/.test(dados)) {
    throw new Error("dados debe tener al menos 10 tiradas, cada una del 1 al 6");
  }
  if (!esHex(firmaDrand, 48) || !esHex(hashBloque, 32)) {
    throw new Error("Se esperaba la firma de drand (48 bytes) y el hash del bloque (32 bytes) en hexadecimal");
  }
  return huellaHex(concatenar(textoABytes(dados), hexABytes(firmaDrand), hexABytes(hashBloque)));
}

// Método de Rivest (sampler.py, 2011): SHA-256 de "semilla,contador" con el contador desde 1,
// el número resultante módulo N, sumado al inicio del rango.
export async function muestraRivest({ semilla, desde = 1, hasta, cantidad, conReemplazo = false }) {
  const tamano = hasta - desde + 1;
  if (!Number.isSafeInteger(tamano) || tamano < 1 || !Number.isSafeInteger(cantidad) || cantidad < 0) {
    throw new Error("Rango o cantidad inválidos");
  }
  if (!conReemplazo && cantidad > tamano) {
    throw new Error("No se pueden sacar más elementos distintos que los que hay");
  }
  const elegidos = [];
  const vistos = new Set();
  let contador = 0;
  while (elegidos.length < cantidad) {
    contador += 1;
    const valor = BigInt("0x" + (await huellaHex(textoABytes(`${semilla},${contador}`))));
    const elegido = desde + Number(valor % BigInt(tamano));
    if (!conReemplazo && vistos.has(elegido)) {
      continue;
    }
    vistos.add(elegido);
    elegidos.push(elegido);
  }
  return elegidos;
}

// Se sortea sobre TODAS las mesas, ordenadas, sin mirar ninguna marca del Carril A (regla de oro del Paso 11).
export async function sortearMesas({ semilla, mesas, cantidad }) {
  const ordenadas = [...new Set(mesas)].sort();
  const posiciones = await muestraRivest({ semilla, hasta: ordenadas.length, cantidad });
  return posiciones.map((posicion) => ordenadas[posicion - 1]);
}

export async function sortearCedulas({ semilla, mesa, totalCedulas, cantidad }) {
  return muestraRivest({ semilla: `${semilla}/${mesa}`, hasta: totalCedulas, cantidad: Math.min(cantidad, totalCedulas) });
}
