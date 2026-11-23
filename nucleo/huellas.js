import { bytesAHex, textoABytes } from "./bytes.js";
import { canonico } from "./json-canonico.js";

export async function huella(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function huellaHex(bytes) {
  return bytesAHex(await huella(bytes));
}

export async function huellaDeObjeto(objeto) {
  return huellaHex(textoABytes(canonico(objeto)));
}
