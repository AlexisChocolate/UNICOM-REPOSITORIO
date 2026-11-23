import { NIVELES } from "./tablero.js";
import { huellaActa, validarFirmasDeActa } from "./acta.js";

// Merkle-diff (Paso 10; DeCandia et al., 2007, sec. 4.7): solo se baja por los hijos cuyas huellas
// difieren, así que k actas alteradas se encuentran en unas k·17 comparaciones.
export function compararTableros(anclado, actual) {
  const alterados = [];
  let comparaciones = 0;
  const pendientes = [{ nivel: NIVELES, indice: 0 }];
  while (pendientes.length > 0) {
    const { nivel, indice } = pendientes.pop();
    comparaciones += 1;
    const nodoAnclado = anclado.nodo(nivel, indice);
    const nodoActual = actual.nodo(nivel, indice);
    if ((nodoAnclado?.huella ?? null) === (nodoActual?.huella ?? null)) {
      continue;
    }
    if (nivel === 0) {
      alterados.push(indice);
      continue;
    }
    pendientes.push({ nivel: nivel - 1, indice: indice * 2 + 1 }, { nivel: nivel - 1, indice: indice * 2 });
  }
  return { alterados: alterados.sort((primero, segundo) => primero - segundo), comparaciones };
}

// En la hoja encontrada se dan las dos pruebas del Paso 10: la matemática (¿la firma de Rosa
// sigue siendo válida sobre lo que dice el servidor?) y los datos para la prueba visual (la foto por su huella).
export async function examinarActa({ ancladaHoja, actaServidor }) {
  if (!actaServidor) {
    return { veredicto: "borrada", detalle: "El acta que estaba en la raíz anclada ya no está en el servidor", foto_sha256: null };
  }
  const huellaRecalculada = await huellaActa(actaServidor.paquete);
  const erroresFirmas = validarFirmasDeActa(actaServidor.firmas, huellaRecalculada);
  const resultado = {
    mesa: actaServidor.paquete.mesa,
    foto_sha256: actaServidor.paquete.foto_sha256,
    votos_servidor: actaServidor.paquete.votos,
    huella_anclada: ancladaHoja?.huellaActa ?? null,
    huella_servidor: huellaRecalculada,
  };
  if (erroresFirmas.length > 0) {
    return { ...resultado, veredicto: "firma_rota", detalle: erroresFirmas.join("; ") };
  }
  if (!ancladaHoja) {
    return { ...resultado, veredicto: "acta_nueva", detalle: "La mesa no tenía acta en la raíz anclada" };
  }
  return {
    ...resultado,
    veredicto: "reemplazada",
    detalle: "El servidor muestra otra acta con firmas válidas: revisar si hay un reemplazo legítimo en el cuaderno",
  };
}
