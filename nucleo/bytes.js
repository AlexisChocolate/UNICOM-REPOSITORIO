const PATRON_HEX = /^(?:[0-9a-f]{2})*$/;

export function esHex(texto, cantidadBytes) {
  if (typeof texto !== "string" || !PATRON_HEX.test(texto)) {
    return false;
  }
  return cantidadBytes === undefined || texto.length === cantidadBytes * 2;
}

export function hexABytes(texto) {
  if (!esHex(texto)) {
    throw new Error("Texto hexadecimal inválido (solo 0-9 y a-f en minúscula, cantidad par)");
  }
  const resultado = new Uint8Array(texto.length / 2);
  for (let posicion = 0; posicion < resultado.length; posicion++) {
    resultado[posicion] = parseInt(texto.slice(posicion * 2, posicion * 2 + 2), 16);
  }
  return resultado;
}

export function bytesAHex(bytes) {
  let texto = "";
  for (const valor of bytes) {
    texto += valor.toString(16).padStart(2, "0");
  }
  return texto;
}

export function concatenar(...partes) {
  const largoTotal = partes.reduce((suma, parte) => suma + parte.length, 0);
  const resultado = new Uint8Array(largoTotal);
  let desplazamiento = 0;
  for (const parte of partes) {
    resultado.set(parte, desplazamiento);
    desplazamiento += parte.length;
  }
  return resultado;
}

export function entero32(valor) {
  const resultado = new Uint8Array(4);
  new DataView(resultado.buffer).setUint32(0, valor, false);
  return resultado;
}

export function entero64(valor) {
  const resultado = new Uint8Array(8);
  new DataView(resultado.buffer).setBigUint64(0, BigInt(valor), false);
  return resultado;
}

export function textoABytes(texto) {
  return new TextEncoder().encode(texto);
}

export function base64urlABytes(texto) {
  const base64 = texto.replace(/-/g, "+").replace(/_/g, "/");
  const relleno = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(relleno);
  const resultado = new Uint8Array(binario.length);
  for (let posicion = 0; posicion < binario.length; posicion++) {
    resultado[posicion] = binario.charCodeAt(posicion);
  }
  return resultado;
}
