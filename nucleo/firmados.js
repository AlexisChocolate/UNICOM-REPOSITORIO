import { esHex } from "./bytes.js";
import { huellaDeObjeto } from "./huellas.js";
import { firmarHuella, verificarFirmaDeHuella } from "./firmas.js";

// Un "objeto firmado" es {contenido, llave_publica, firma}: la firma Ed25519 va sobre la huella
// del JSON canónico del contenido. Lo usan el padrón, los reemplazos de llave, las objeciones y las decisiones.
export async function firmarObjeto(llavePrivada, llavePublica, contenido) {
  const huellaContenido = await huellaDeObjeto(contenido);
  return { contenido, llave_publica: llavePublica, firma: await firmarHuella(llavePrivada, huellaContenido) };
}

// Lo que firma Rosa al pedir una lectura al lector de IA (arquitectura, sec. 5.4): la foto reducida que envía
// queda atada a la firma por su huella, y la fecha impide reusar la petición más tarde.
export function contenidoPeticionLectura(peticion) {
  return {
    fecha: peticion.fecha,
    huella_foto: peticion.huella_foto,
    huella_imagen_enviada: peticion.huella_imagen_enviada,
    mesa: peticion.mesa,
    momento: peticion.momento,
  };
}

export async function verificarObjetoFirmado(objeto) {
  if (!objeto || typeof objeto !== "object" || !esHex(objeto.llave_publica, 32)) {
    return false;
  }
  try {
    return verificarFirmaDeHuella(objeto.firma, await huellaDeObjeto(objeto.contenido), objeto.llave_publica);
  } catch {
    return false;
  }
}
