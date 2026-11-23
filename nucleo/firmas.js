import { ed25519 } from "@noble/curves/ed25519.js";
import { base64urlABytes, bytesAHex, esHex, hexABytes } from "./bytes.js";
import { huellaDeObjeto } from "./huellas.js";

// Se verifica en modo estricto de RFC 8032 (zip215: false) porque quien firma es Web Crypto,
// que sigue RFC 8032; aceptar codificaciones ZIP-215 abriría las discrepancias de la sec. 8.8.
export function verificarFirma(firmaHex, mensaje, llavePublicaHex) {
  if (!esHex(firmaHex, 64) || !esHex(llavePublicaHex, 32)) {
    return false;
  }
  try {
    return ed25519.verify(hexABytes(firmaHex), mensaje, hexABytes(llavePublicaHex), { zip215: false });
  } catch {
    return false;
  }
}

export function verificarFirmaDeHuella(firmaHex, huellaHexTexto, llavePublicaHex) {
  if (!esHex(huellaHexTexto, 32)) {
    return false;
  }
  return verificarFirma(firmaHex, hexABytes(huellaHexTexto), llavePublicaHex);
}

export async function generarLlaveNoExportable() {
  return crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
}

export async function llavePublicaHex(llavePublica) {
  return bytesAHex(new Uint8Array(await crypto.subtle.exportKey("raw", llavePublica)));
}

export async function firmarConWebCrypto(llavePrivada, mensaje) {
  return bytesAHex(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, llavePrivada, mensaje)));
}

export async function firmarHuella(llavePrivada, huellaHexTexto) {
  return firmarConWebCrypto(llavePrivada, hexABytes(huellaHexTexto));
}

export async function importarLlaveServidor(jwkTexto) {
  const jwk = JSON.parse(jwkTexto.trim());
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.d !== "string" || typeof jwk.x !== "string") {
    throw new Error("La llave del servidor debe ser un JWK Ed25519 con los campos d y x");
  }
  const llavePrivada = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
  return { llavePrivada, llavePublica: bytesAHex(base64urlABytes(jwk.x)) };
}

export async function firmarDocumento(llavePrivada, contenido) {
  const huellaContenido = await huellaDeObjeto(contenido);
  const firma = await firmarHuella(llavePrivada, huellaContenido);
  return { contenido, huella: huellaContenido, firma };
}

export async function verificarDocumento(documento, llavePublicaHex) {
  if (!documento || typeof documento !== "object") {
    return false;
  }
  const huellaCalculada = await huellaDeObjeto(documento.contenido);
  if (huellaCalculada !== documento.huella) {
    return false;
  }
  return verificarFirmaDeHuella(documento.firma, huellaCalculada, llavePublicaHex);
}
