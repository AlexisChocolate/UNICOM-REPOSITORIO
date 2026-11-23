import {
  CATEGORIAS,
  aplicarRenglones,
  construirTablero,
  estadoVacio,
  hojasDelEstado,
  huellaHex,
  llaveParaRenglon,
  totalesConNombre,
  verificarCadenaRaices,
  verificarCuaderno,
  verificarDocumento,
} from "../nucleo/index.js";

// El auditor continuo (Paso 9). Usa solo datos públicos y el mismo núcleo que el verificador de Juan.
// No alerta porque la raíz cambie (eso pasa con cada acta): alerta solo ante inconsistencias.
export async function auditar({ fuente, estadoPrevio = {}, raicesDelRepositorio = [], vistasDeOtros = [], fotosPorRevisar = 20 }) {
  const alertas = [];
  const avisos = [];
  const alertar = (revision, mensaje, detalle = undefined) => alertas.push({ revision, mensaje, detalle });

  const [renglones, raices] = await Promise.all([fuente.cuaderno(), fuente.raices()]);

  // Revisión 1: el cuaderno solo crece y ningún renglón cambió.
  const cadena = await verificarCuaderno(renglones);
  if (!cadena.valido) {
    alertar(1, `El cuaderno está roto en el renglón ${cadena.renglon}: ${cadena.motivo}`);
  }
  const ultimoVisto = estadoPrevio.ultimo_renglon;
  if (ultimoVisto) {
    const mismo = renglones.find((renglon) => renglon.numero === ultimoVisto.numero);
    if (!mismo) {
      alertar(1, `El cuaderno se achicó: ya no existe el renglón ${ultimoVisto.numero} que este auditor vio`);
    } else if (mismo.huella !== ultimoVisto.huella) {
      alertar(1, `El renglón ${ultimoVisto.numero} cambió desde la última auditoría: alguien reescribió el cuaderno`);
    }
  }

  // Revisión 2: cada firma es válida y su llave está en el padrón (reconstruido desde el propio cuaderno).
  const estado = estadoVacio();
  const fotografias = [];
  const hojasPorRaiz = new Map();
  const raicesPorRenglones = new Map();
  for (const raiz of raices) {
    if (raiz.contenido.tipo === "raiz") {
      raicesPorRenglones.set(raiz.contenido.renglones, [...(raicesPorRenglones.get(raiz.contenido.renglones) ?? []), raiz]);
    }
  }
  const cortes = [0, ...[...raicesPorRenglones.keys()].sort((primero, segundo) => primero - segundo)];
  let aplicados = 0;
  for (const corte of cortes) {
    await aplicarRenglones(estado, renglones.slice(aplicados, corte));
    aplicados = Math.max(aplicados, corte);
    for (const raiz of raicesPorRenglones.get(corte) ?? []) {
      hojasPorRaiz.set(raiz.contenido.numero, hojasDelEstado(estado));
    }
  }
  await aplicarRenglones(estado, renglones.slice(aplicados));
  for (const problema of estado.problemas) {
    alertar(2, `Renglón ${problema.renglon} (${problema.tipo}): ${problema.motivo}`);
  }
  for (const acta of estado.actas.values()) {
    fotografias.push({ mesa: acta.mesa, huella: acta.paquete.foto_sha256, renglon: acta.renglon });
  }

  // Revisión 3: cada foto coincide con la huella sellada (se revisan las nuevas y una muestra de las demás).
  const desdeRenglonFotos = estadoPrevio.ultimo_renglon?.numero ?? 0;
  const nuevas = fotografias.filter((foto) => foto.renglon > desdeRenglonFotos);
  const viejas = fotografias.filter((foto) => foto.renglon <= desdeRenglonFotos).slice(0, Math.max(0, fotosPorRevisar - nuevas.length));
  for (const foto of [...nuevas, ...viejas]) {
    const bytes = await fuente.foto(foto.huella);
    if (!bytes) {
      avisos.push({ revision: 3, mensaje: `La foto de la mesa ${foto.mesa} todavía no está en el servidor` });
    } else if ((await huellaHex(bytes)) !== foto.huella) {
      alertar(3, `La foto de la mesa ${foto.mesa} no coincide con la huella que selló el acta`, { huella: foto.huella });
    }
  }

  // Revisión 4: las sumas cuadran; el tablero se recalcula entero y se compara con cada raíz publicada.
  const tableroActual = await construirTablero(hojasDelEstado(estado), CATEGORIAS.length);
  const tableroServidor = await fuente.tablero();
  if (tableroServidor && tableroServidor.raiz_tablero !== tableroActual.raiz.huella) {
    alertar(4, "El tablero del servidor no es el que resulta de las actas válidas del cuaderno", {
      servidor: tableroServidor.raiz_tablero,
      recalculado: tableroActual.raiz.huella,
    });
  }
  const arboles = [];
  const desdeRaiz = estadoPrevio.ultima_raiz?.numero ?? -1;
  for (const raiz of raices) {
    const hojas = hojasPorRaiz.get(raiz.contenido.numero);
    if (!hojas || raiz.contenido.numero <= desdeRaiz) {
      continue;
    }
    const tablero = await construirTablero(hojas, CATEGORIAS.length);
    if (tablero.raiz.huella !== raiz.contenido.raiz_tablero) {
      alertar(4, `La raíz n.º ${raiz.contenido.numero} no es la que resulta de recalcular el tablero con sus actas`);
    } else if (JSON.stringify(totalesConNombre(tablero.raiz.sumas)) !== JSON.stringify(raiz.contenido.totales)) {
      alertar(4, `Los totales firmados en la raíz n.º ${raiz.contenido.numero} no son la suma de las actas`);
    }
    arboles.push({ numero: raiz.contenido.numero, huella: raiz.huella, raiz_tablero: raiz.contenido.raiz_tablero, renglones: raiz.contenido.renglones, hojas });
  }

  // Revisión 5: la cadena de raíces no tiene saltos, coincide con la publicada en el repositorio y con la de otros auditores.
  const llaveDelRepositorio = raicesDelRepositorio[0]?.contenido?.llave_publica_servidor ?? null;
  const cadenaRaices = raices.length > 0 ? await verificarCadenaRaices(raices, llaveDelRepositorio) : { valida: true };
  if (!cadenaRaices.valida) {
    alertar(5, `La cadena de raíces no es válida en la n.º ${cadenaRaices.numero}: ${cadenaRaices.motivo}`);
  }
  for (const publicada of raicesDelRepositorio) {
    const delServidor = raices[publicada.contenido.numero];
    if (!delServidor || delServidor.huella !== publicada.huella) {
      alertar(5, `La raíz n.º ${publicada.contenido.numero} del repositorio no es la que muestra el servidor: hay dos versiones`);
    }
  }
  for (const vista of vistasDeOtros) {
    const propia = raices[vista.raiz?.numero];
    if (propia && propia.huella !== vista.raiz.huella) {
      alertar(5, `El auditor ${vista.auditor} vio otra raíz n.º ${vista.raiz.numero}: el servidor muestra versiones distintas`);
    }
  }

  // Revisión 6: cada recibo entregado corresponde a su renglón del cuaderno.
  for (const renglon of renglones.filter((fila) => fila.tipo === "acta" && fila.numero > desdeRenglonFotos)) {
    const recibo = await fuente.recibo(renglon.numero);
    if (!recibo) {
      alertar(6, `Falta el recibo del renglón ${renglon.numero}`);
      continue;
    }
    const llave = llaveParaRenglon(raices, renglon.numero) ?? llaveDelRepositorio;
    const firmaValida = llave ? await verificarDocumento(recibo, llave) : false;
    if (!firmaValida || recibo.contenido.huella_renglon !== renglon.huella || recibo.contenido.huella_acta !== renglon.contenido.huella_acta) {
      alertar(6, `El recibo del renglón ${renglon.numero} no corresponde a ese renglón`);
    }
  }

  const ultimaRaiz = raices.at(-1);
  const ultimoRenglon = renglones.at(-1);
  return {
    alertas,
    avisos,
    resumen: {
      fuente: fuente.descripcion,
      renglones: renglones.length,
      actas: estado.actas.size,
      raices: raices.length,
      raiz_tablero_recalculada: tableroActual.raiz.huella,
      totales: totalesConNombre(tableroActual.raiz.sumas),
    },
    nuevoEstado: {
      ultimo_renglon: ultimoRenglon ? { numero: ultimoRenglon.numero, huella: ultimoRenglon.huella } : estadoPrevio.ultimo_renglon ?? null,
      ultima_raiz: ultimaRaiz ? { numero: ultimaRaiz.contenido.numero, huella: ultimaRaiz.huella } : estadoPrevio.ultima_raiz ?? null,
    },
    arboles,
  };
}
