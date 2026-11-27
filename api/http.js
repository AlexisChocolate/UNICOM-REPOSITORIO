import { ErrorUnicom } from "./ventanilla.js";

export const TAMANO_MAXIMO_CUERPO = 64 * 1024;

export function respuestaJson(datos, estado = 200, encabezados = {}) {
  return new Response(JSON.stringify(datos, null, 2), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", ...encabezados },
  });
}

export function respuestaDeError(error) {
  if (error instanceof ErrorUnicom) {
    return respuestaJson({ error: error.codigo, mensaje: error.message, detalles: error.detalles }, error.estado);
  }
  return respuestaJson({ error: "error_interno", mensaje: "Error inesperado en el servidor" }, 500);
}

export async function leerCuerpoJson(peticion) {
  const texto = await peticion.text();
  if (texto.length > TAMANO_MAXIMO_CUERPO) {
    throw new ErrorUnicom(413, "cuerpo_muy_grande", `El cuerpo no puede pasar de ${TAMANO_MAXIMO_CUERPO} bytes`);
  }
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorUnicom(400, "json_invalido", "El cuerpo no es un JSON válido");
  }
}

// CORS solo decide qué páginas pueden leer la respuesta desde un navegador; la seguridad real
// la dan las firmas y el padrón, porque cualquier programa fuera del navegador ignora CORS.
export function encabezadosCors(peticion, origenesPermitidos) {
  const origen = peticion.headers.get("origin");
  const permitidos = (origenesPermitidos ?? "").split(",").map((texto) => texto.trim()).filter(Boolean);
  if (!origen || !permitidos.includes(origen)) {
    return {};
  }
  return {
    "access-control-allow-origin": origen,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    // POST /fotos manda la llave y la firma en encabezados propios: sin listarlos aquí, el navegador corta la subida.
    "access-control-allow-headers": "content-type, authorization, x-unicom-llave, x-unicom-firma",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

export function conCors(respuesta, cors) {
  const nueva = new Response(respuesta.body, respuesta);
  for (const [nombre, valor] of Object.entries(cors)) {
    nueva.headers.set(nombre, valor);
  }
  return nueva;
}

async function huellaDeTexto(texto) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

// Se comparan las huellas y no los textos, para que el tiempo de respuesta no revele cuántos caracteres acertó alguien.
export async function comprobarClaveAdmin(peticion, claveAdmin) {
  if (!claveAdmin) {
    throw new ErrorUnicom(503, "admin_no_configurado", "Falta configurar el secreto CLAVE_ADMIN en el Worker");
  }
  const encabezado = peticion.headers.get("authorization") ?? "";
  const recibida = encabezado.startsWith("Bearer ") ? encabezado.slice(7).trim() : "";
  const [huellaRecibida, huellaEsperada] = await Promise.all([huellaDeTexto(recibida), huellaDeTexto(claveAdmin.trim())]);
  let diferencias = 0;
  for (let posicion = 0; posicion < huellaEsperada.length; posicion++) {
    diferencias |= huellaRecibida[posicion] ^ huellaEsperada[posicion];
  }
  if (diferencias !== 0) {
    throw new ErrorUnicom(401, "no_autorizado", "Esta operación necesita la clave de administración");
  }
}
