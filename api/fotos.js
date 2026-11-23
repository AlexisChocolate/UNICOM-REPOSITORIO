import { esHex, huellaHex, verificarFirmaDeHuella } from "../nucleo/index.js";
import { ErrorUnicom } from "./ventanilla.js";

export const BYTES_MAXIMOS_FOTO = 10 * 1024 * 1024;
export const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];

export function claveDeFoto(huella) {
  return `fotos/${huella}`;
}

// La foto se guarda por su huella (Paso 6): el nombre ES la huella, así cualquier copia se verifica sola.
// Solo suben fotos llaves del padrón, para que nadie use R2 de basurero.
export async function subirFoto({ bytes, tipo, llavePublica, firma, almacen, archivos, ahora }) {
  if (!TIPOS_FOTO.includes(tipo)) {
    throw new ErrorUnicom(415, "tipo_no_permitido", `La foto debe ser ${TIPOS_FOTO.join(", ")}`);
  }
  if (bytes.length === 0 || bytes.length > BYTES_MAXIMOS_FOTO) {
    throw new ErrorUnicom(413, "foto_muy_grande", "La foto debe pesar entre 1 byte y 10 MB");
  }
  const huella = await huellaHex(bytes);
  if (!esHex(llavePublica, 32) || !verificarFirmaDeHuella(firma, huella, llavePublica)) {
    throw new ErrorUnicom(400, "firma_invalida", "x-unicom-firma debe ser la firma Ed25519 de la huella SHA-256 de la foto");
  }
  const [[registro], [reemplazo]] = await Promise.all([almacen.leerPadron([llavePublica]), almacen.leerReemplazos([llavePublica])]);
  if (!registro || reemplazo) {
    throw new ErrorUnicom(403, "firmante_no_registrado", "Solo las llaves vigentes del padrón pueden subir fotos");
  }
  const existente = await almacen.leerFoto(huella);
  if (!existente) {
    await archivos.guardar(claveDeFoto(huella), bytes, tipo);
    await almacen.guardarFoto({ huella, tipo, tamano: bytes.length, subidaPor: llavePublica, fecha: ahora.toISOString() });
  }
  return { huella, tamano: bytes.length, ya_existia: Boolean(existente) };
}

export async function bajarFoto({ huella, almacen, archivos }) {
  const registro = await almacen.leerFoto(huella);
  const archivo = registro ? await archivos.leer(claveDeFoto(huella)) : null;
  if (!archivo) {
    throw new ErrorUnicom(404, "foto_inexistente", "No hay una foto con esa huella en el servidor; búsquela en otra copia por su huella");
  }
  return { bytes: archivo.bytes, tipo: registro.tipo };
}
