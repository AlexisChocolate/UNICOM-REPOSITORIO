import { CATEGORIAS, casilleroDeMesa, compararTableros, construirTablero, examinarActa, huellaActa, sumasDeVotos } from "../nucleo/index.js";

// Lo que el servidor dice HOY, sin filtrar nada: la última acta de cada mesa tal como está en su cuaderno.
// No se valida a propósito, porque justamente se busca lo que alguien cambió.
export async function actasSegunServidor(renglones) {
  const actas = new Map();
  for (const renglon of renglones) {
    if (renglon.tipo !== "acta") {
      continue;
    }
    const { paquete, firmas } = renglon.contenido;
    try {
      actas.set(paquete.mesa, {
        mesa: paquete.mesa,
        casillero: casilleroDeMesa(paquete.mesa),
        huellaActa: await huellaActa(paquete),
        sumas: sumasDeVotos(paquete.votos),
        paquete,
        firmas,
        renglon: renglon.numero,
      });
    } catch {
      continue;
    }
  }
  return actas;
}

// El detective (Paso 10): compara la copia del árbol anclado con lo que dice el servidor ahora
// y baja hasta cada mesa cambiada.
export async function investigar({ arbolAnclado, renglonesActuales }) {
  // Se compara contra lo que el servidor dice HOY de los mismos renglones que cubría la raíz anclada.
  const hasta = arbolAnclado.renglones ?? Number.MAX_SAFE_INTEGER;
  const actuales = await actasSegunServidor(renglonesActuales.filter((renglon) => renglon.numero <= hasta));
  const anclado = await construirTablero(arbolAnclado.hojas, CATEGORIAS.length);
  const hojasActuales = [...actuales.values()].map(({ casillero, huellaActa, sumas }) => ({ casillero, huellaActa, sumas }));
  const actual = await construirTablero(hojasActuales, CATEGORIAS.length);
  const { alterados, comparaciones } = compararTableros(anclado, actual);
  const hallazgos = [];
  for (const casillero of alterados) {
    const ancladaHoja = arbolAnclado.hojas.find((hoja) => hoja.casillero === casillero) ?? null;
    const actaServidor = [...actuales.values()].find((acta) => acta.casillero === casillero) ?? null;
    hallazgos.push({ casillero, ...(await examinarActa({ ancladaHoja, actaServidor })) });
  }
  return { raiz_anclada: anclado.raiz.huella, raiz_actual: actual.raiz.huella, comparaciones, hallazgos };
}
