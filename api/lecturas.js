import {
  CATEGORIAS,
  NIVELES,
  casilleroDeMesa,
  completarHermanos,
  posicionesHermanas,
  totalesConNombre,
  vaciosPorNivel,
} from "../nucleo/index.js";
import { ErrorUnicom } from "./ventanilla.js";

export async function estadoTablero(almacen) {
  const [nodoRaiz] = await almacen.leerNodos([{ nivel: NIVELES, indice: 0 }]);
  const raiz = nodoRaiz ?? (await vaciosPorNivel(CATEGORIAS.length))[NIVELES];
  return {
    categorias: CATEGORIAS,
    niveles: NIVELES,
    raiz_tablero: raiz.huella,
    totales: totalesConNombre(raiz.sumas),
    ultimo_renglon: await almacen.ultimoRenglon(),
  };
}

// La hoja, los 17 hermanos y la raíz se leen en una sola consulta en lote, para que la prueba
// corresponda a una misma foto del tablero aunque en ese momento llegue otra acta.
export async function pruebaDeMesa(almacen, mesa) {
  let casillero;
  try {
    casillero = casilleroDeMesa(mesa);
  } catch (error) {
    throw new ErrorUnicom(400, "mesa_invalida", error.message);
  }
  const posiciones = [{ nivel: 0, indice: casillero }, ...posicionesHermanas(casillero), { nivel: NIVELES, indice: 0 }];
  const { acta, nodos } = await almacen.leerActaConCamino(mesa, posiciones);
  if (!acta) {
    throw new ErrorUnicom(404, "mesa_sin_acta", `La mesa ${mesa} todavía no tiene un acta registrada`);
  }
  const hoja = nodos[0];
  const hermanos = await completarHermanos(nodos.slice(1, NIVELES + 1), CATEGORIAS.length);
  const raiz = nodos[NIVELES + 1];
  const [renglon] = await almacen.leerRenglones(acta.renglon, 1);
  return {
    mesa,
    casillero,
    huella_acta: acta.huella_acta,
    renglon: acta.renglon,
    paquete: renglon.contenido.paquete,
    firmas: renglon.contenido.firmas,
    sumas: hoja.sumas,
    hermanos,
    raiz,
  };
}

export function leerEnteroDeConsulta(url, nombre, porDefecto, minimo, maximo) {
  const texto = url.searchParams.get(nombre);
  if (texto === null) {
    return porDefecto;
  }
  const valor = Number(texto);
  if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) {
    throw new ErrorUnicom(400, "parametro_invalido", `${nombre} debe ser un entero entre ${minimo} y ${maximo}`);
  }
  return valor;
}
