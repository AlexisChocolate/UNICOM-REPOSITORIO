import {
  API,
  API_ES_LA_PUBLICADA,
  comprobacion,
  crear,
  elemento,
  fechaLegible,
  fotoVerificada,
  iniciarPagina,
  leerCuadernoCompleto,
  leerRaicesCompletas,
  leerRaicesDelRepositorio,
  mensaje,
  mensajeDeError,
  pedir,
  textoCorto,
} from "./comun.js";
import { tablaDeVotos } from "./vista-acta.js";

const nucleo = await iniciarPagina();

const REVISIONES = [
  "El cuaderno solo crece y ningún renglón cambió",
  "Cada firma es válida y su llave está en el padrón",
  "Cada foto coincide con la huella sellada",
  "Las sumas del tablero cuadran en cada cruce",
  "La cadena de raíces no tiene saltos y coincide con el repositorio y con otros auditores",
  "Cada recibo corresponde a un renglón del cuaderno",
  "La historia del repositorio continúa a la que ya se tenía",
];

const CLAVE_ESTADO_AUDITOR = `unicom-auditor-${API}`;

async function leerJsonPublicado(ruta) {
  const respuesta = await fetch(ruta, { cache: "no-store" }).catch(() => null);
  return respuesta?.ok ? respuesta.json() : null;
}

function listaDeRevisiones(alertas) {
  return REVISIONES.map((titulo, posicion) => {
    const numero = posicion + 1;
    const propias = alertas.filter((alerta) => alerta.revision === numero);
    if (numero === 7 && propias.length === 0) {
      return comprobacion(null, `${numero}. ${titulo}`, "Solo la revisa un auditor con su propio clon del repositorio.");
    }
    return comprobacion(propias.length === 0, `${numero}. ${titulo}`, propias.map((alerta) => alerta.mensaje).join(" · ") || undefined);
  });
}

async function cargarInformePublicado() {
  const contenedor = elemento("informe-publicado");
  const [informe, ultimaVista] = await Promise.all([leerJsonPublicado("../auditor/publicado/informe.json"), leerJsonPublicado("../auditor/publicado/ultima-vista.json")]);
  if (!informe) {
    contenedor.replaceChildren(mensaje("aviso", "No se encontró auditor/publicado/informe.json."));
    return;
  }
  const piezas = [
    comprobacion(informe.alertas.length === 0, informe.alertas.length === 0 ? "Sin alertas" : `${informe.alertas.length} alerta(s)`, `Auditoría del ${fechaLegible(informe.fecha)} sobre ${informe.resumen.fuente}`),
    ...listaDeRevisiones(informe.alertas),
    crear("p", "nota", `${informe.resumen.renglones} renglones · ${informe.resumen.actas} acta(s) · ${informe.resumen.raices} raíces`),
  ];
  if (ultimaVista) {
    piezas.push(crear("p", "nota", `Última raíz que vio (n.º ${ultimaVista.raiz.numero}), para que otros auditores comparen:`), crear("div", "huella", ultimaVista.raiz.huella));
  }
  if (!API_ES_LA_PUBLICADA) {
    piezas.push(mensaje("aviso", "Este informe es del servidor en internet, no del servidor local que estás usando."));
  }
  contenedor.replaceChildren(...piezas);
}

async function auditarAhora() {
  const contenedor = elemento("auditoria");
  const boton = elemento("auditar");
  boton.disabled = true;
  contenedor.replaceChildren(mensaje("", "Auditando: leyendo el cuaderno y recalculando el tablero…"));
  try {
    const estadoPrevio = JSON.parse(localStorage.getItem(CLAVE_ESTADO_AUDITOR) ?? "{}");
    const raicesDelRepositorio = API_ES_LA_PUBLICADA ? await leerRaicesDelRepositorio() : [];
    const vistaPublicada = API_ES_LA_PUBLICADA ? await leerJsonPublicado("../auditor/publicado/ultima-vista.json") : null;
    const [{ auditar }, { fuenteHttp }] = await Promise.all([import("../auditor/auditor.js"), import("../auditor/fuentes.js")]);
    const resultado = await auditar({
      fuente: fuenteHttp(API),
      estadoPrevio,
      raicesDelRepositorio,
      vistasDeOtros: vistaPublicada ? [vistaPublicada] : [],
    });
    localStorage.setItem(CLAVE_ESTADO_AUDITOR, JSON.stringify(resultado.nuevoEstado));
    const piezas = [
      comprobacion(resultado.alertas.length === 0, resultado.alertas.length === 0 ? "Todo íntegro: ninguna inconsistencia" : `${resultado.alertas.length} inconsistencia(s) encontradas`),
      ...listaDeRevisiones(resultado.alertas),
    ];
    if (resultado.avisos.length > 0) {
      piezas.push(mensaje("aviso", "Avisos (no son alertas):", resultado.avisos.map((aviso) => aviso.mensaje)));
    }
    const fuentes = [estadoPrevio.ultimo_renglon ? `continúa desde el renglón ${estadoPrevio.ultimo_renglon.numero} que este navegador ya había visto` : "primera auditoría desde este navegador"];
    if (API_ES_LA_PUBLICADA) {
      fuentes.push(`${raicesDelRepositorio.length} raíces comparadas con el repositorio`);
    }
    piezas.push(
      crear("p", "nota", `${resultado.resumen.renglones} renglones · ${resultado.resumen.actas} acta(s) · ${resultado.resumen.raices} raíces · ${fuentes.join(" · ")}`),
      crear("p", "nota", "Totales recalculados por este navegador desde las actas firmadas:"),
      tablaDeVotos(nucleo, resultado.resumen.totales),
    );
    contenedor.replaceChildren(...piezas);
  } catch (error) {
    contenedor.replaceChildren(mensajeDeError(error));
  } finally {
    boton.disabled = false;
  }
}

// Copia del árbol de la última raíz, como la que guarda el auditor al anclar (Paso 9): sin ella, el detective no tiene contra qué comparar.
async function copiaDelArbolDeLaUltimaRaiz() {
  const [raices, renglones] = await Promise.all([leerRaicesCompletas(), leerCuadernoCompleto()]);
  const ultima = [...raices].reverse().find((raiz) => raiz.contenido.tipo === "raiz");
  if (!ultima) {
    throw new Error("Todavía no hay una raíz publicada con actas.");
  }
  const estadoEnLaRaiz = await nucleo.reconstruirEstado(renglones.filter((renglon) => renglon.numero <= ultima.contenido.renglones));
  const hojas = nucleo.hojasDelEstado(estadoEnLaRaiz);
  const tablero = await nucleo.construirTablero(hojas, nucleo.CATEGORIAS.length);
  if (tablero.raiz.huella !== ultima.contenido.raiz_tablero) {
    throw new Error(`El cuaderno de hoy ya no reconstruye la raíz n.º ${ultima.contenido.numero}: no se puede hacer una copia confiable ahora.`);
  }
  return { numero: ultima.contenido.numero, huella: ultima.huella, raiz_tablero: ultima.contenido.raiz_tablero, renglones: ultima.contenido.renglones, hojas };
}

async function descargarArbol() {
  const contenedor = elemento("detective");
  try {
    const copia = await copiaDelArbolDeLaUltimaRaiz();
    const enlace = crear("a");
    enlace.href = URL.createObjectURL(new Blob([JSON.stringify(copia, null, 2)], { type: "application/json" }));
    enlace.download = `raiz-${String(copia.numero).padStart(4, "0")}.json`;
    enlace.click();
    contenedor.replaceChildren(mensaje("ok", `Copia del árbol de la raíz n.º ${copia.numero} descargada (${copia.hojas.length} mesa(s)). Guárdala: el detective la usará si algo cambia.`));
  } catch (error) {
    contenedor.replaceChildren(mensajeDeError(error));
  }
}

const VEREDICTOS = {
  firma_rota: { estado: false, titulo: "Alterada: la firma de la mesa ya no es válida" },
  borrada: { estado: false, titulo: "Borrada: el acta anclada ya no está en el servidor" },
  reemplazada: { estado: null, titulo: "Reemplazada por otra acta con firma válida: revisar si fue una corrección legítima" },
  acta_nueva: { estado: null, titulo: "Acta nueva: no estaba en la raíz anclada" },
};

async function pintarHallazgo(hallazgo, arbolAnclado) {
  const tarjeta = crear("div", "tarjeta");
  const veredicto = VEREDICTOS[hallazgo.veredicto] ?? { estado: null, titulo: hallazgo.veredicto };
  tarjeta.append(comprobacion(veredicto.estado, `Casillero ${hallazgo.casillero}${hallazgo.mesa ? ` · mesa ${hallazgo.mesa}` : ""}: ${veredicto.titulo}`, hallazgo.detalle));
  const lado = crear("div", "lado-a-lado");
  const columnaFoto = crear("div", "tarjeta");
  columnaFoto.append(crear("h3", "", "Foto original"));
  if (hallazgo.foto_sha256) {
    const foto = await fotoVerificada(nucleo, hallazgo.foto_sha256);
    if (foto.encontrada) {
      const imagen = crear("img", "vista-previa");
      imagen.src = foto.url;
      imagen.alt = "Foto del acta";
      columnaFoto.append(comprobacion(foto.coincide, foto.coincide ? "Huella verificada" : "La foto tampoco coincide: buscar otra copia"), imagen);
    } else {
      columnaFoto.append(comprobacion(null, "Foto no disponible en el servidor", "Buscarla por su huella en el repositorio o en el celular de la mesa."));
    }
    columnaFoto.append(crear("div", "huella", hallazgo.foto_sha256));
  }
  const hojaAnclada = arbolAnclado.hojas.find((hoja) => hoja.casillero === hallazgo.casillero);
  const columnaAnclada = crear("div", "tarjeta");
  columnaAnclada.append(crear("h3", "", "Lo que estaba anclado"));
  if (hojaAnclada) {
    columnaAnclada.append(tablaDeVotos(nucleo, nucleo.totalesConNombre(hojaAnclada.sumas)), crear("div", "huella", hojaAnclada.huellaActa));
  } else {
    columnaAnclada.append(crear("p", "nota", "Sin acta en esa raíz."));
  }
  const columnaServidor = crear("div", "tarjeta");
  columnaServidor.append(crear("h3", "", "Lo que dice el servidor ahora"));
  if (hallazgo.votos_servidor) {
    columnaServidor.append(tablaDeVotos(nucleo, hallazgo.votos_servidor), crear("div", "huella", hallazgo.huella_servidor));
  } else {
    columnaServidor.append(crear("p", "nota", "No hay acta."));
  }
  lado.append(columnaFoto, columnaAnclada, columnaServidor);
  tarjeta.append(lado);
  return tarjeta;
}

async function investigarAhora() {
  const contenedor = elemento("detective");
  const archivo = elemento("arbol-anclado").files[0];
  if (!archivo) {
    contenedor.replaceChildren(mensaje("mal", "Elige primero el archivo con la copia del árbol anclado."));
    return;
  }
  contenedor.replaceChildren(mensaje("", "Comparando árboles…"));
  try {
    const arbolAnclado = JSON.parse(await archivo.text());
    if (!Array.isArray(arbolAnclado.hojas)) {
      throw new Error("El archivo no es una copia de árbol: le falta la lista de hojas.");
    }
    const { investigar } = await import("../auditor/investigacion.js");
    const resultado = await investigar({ arbolAnclado, renglonesActuales: await leerCuadernoCompleto() });
    const piezas = [
      comprobacion(
        resultado.hallazgos.length === 0,
        resultado.hallazgos.length === 0 ? "El servidor todavía reconstruye la raíz anclada: nada cambió" : `${resultado.hallazgos.length} mesa(s) cambiaron desde la raíz anclada`,
        `Raíz anclada ${textoCorto(resultado.raiz_anclada)} · raíz de hoy ${textoCorto(resultado.raiz_actual)} · ${resultado.comparaciones} comparaciones`,
      ),
    ];
    for (const hallazgo of resultado.hallazgos) {
      piezas.push(await pintarHallazgo(hallazgo, arbolAnclado));
    }
    contenedor.replaceChildren(...piezas);
  } catch (error) {
    contenedor.replaceChildren(mensajeDeError(error));
  }
}

async function usarRondaActual() {
  elemento("ronda-drand").value = String(nucleo.rondaDrandEnFecha(new Date()) - 1);
}

async function usarUltimoBloque() {
  const contenedor = elemento("sorteo");
  try {
    const respuesta = await fetch("https://mempool.space/api/blocks/tip/hash");
    if (!respuesta.ok) {
      throw new Error(`mempool.space respondió ${respuesta.status}`);
    }
    elemento("hash-bloque").value = (await respuesta.text()).trim();
  } catch (error) {
    contenedor.replaceChildren(mensaje("mal", `No se pudo leer el último bloque: ${error.message}`));
  }
}

async function sortear() {
  const contenedor = elemento("sorteo");
  const dados = elemento("dados").value.trim();
  const ronda = Number(elemento("ronda-drand").value);
  const hashBloque = elemento("hash-bloque").value.trim().toLowerCase();
  const cantidadMesas = Number(elemento("cantidad-mesas").value);
  const cantidadCedulas = Number(elemento("cantidad-cedulas").value);
  contenedor.replaceChildren(mensaje("", "Comprobando las tres fuentes de azar…"));
  try {
    const respuestaDrand = await fetch(`https://api.drand.sh/${nucleo.DRAND_QUICKNET.hash}/public/${ronda}`);
    if (!respuestaDrand.ok) {
      throw new Error(`drand no tiene la ronda ${ronda} (respondió ${respuestaDrand.status})`);
    }
    const rondaDrand = await respuestaDrand.json();
    const drandValida = await nucleo.verificarRondaDrand(rondaDrand);
    const respuestaBloque = await fetch(`https://mempool.space/api/block/${hashBloque}/header`);
    if (!respuestaBloque.ok) {
      throw new Error(`mempool.space no encontró el bloque (respondió ${respuestaBloque.status})`);
    }
    const bloqueValido = await nucleo.verificarEncabezadoBitcoin((await respuestaBloque.text()).trim(), hashBloque);
    const piezas = [
      comprobacion(drandValida, drandValida ? `La ronda ${ronda} de drand tiene una firma válida` : "La firma de drand NO es válida"),
      comprobacion(bloqueValido, bloqueValido ? "El encabezado del bloque de Bitcoin corresponde a su hash" : "El bloque de Bitcoin NO corresponde a su hash"),
    ];
    if (!drandValida || !bloqueValido) {
      contenedor.replaceChildren(...piezas);
      return;
    }
    const semilla = await nucleo.semillaSorteo({ dados, firmaDrand: rondaDrand.signature, hashBloque });
    const { mesas } = await pedir("/mesas");
    const sorteadas = await nucleo.sortearMesas({ semilla, mesas, cantidad: Math.min(cantidadMesas, mesas.length) });
    piezas.push(crear("p", "nota", "Semilla = SHA-256(dados ‖ firma de drand ‖ hash del bloque):"), crear("div", "huella", semilla));
    const lista = crear("ul", "lista-simple");
    for (const mesa of sorteadas) {
      const datos = await pedir(`/actas/${mesa}`);
      const totalCedulas = Object.values(datos.paquete.votos).reduce((suma, cantidad) => suma + cantidad, 0);
      const cedulas = totalCedulas > 0 ? await nucleo.sortearCedulas({ semilla, mesa, totalCedulas, cantidad: cantidadCedulas }) : [];
      const fila = crear("li");
      fila.append(crear("strong", "", `Mesa ${mesa}`), crear("div", "nota", `Cédulas del sobre lacrado a revisar (de ${totalCedulas}): ${cedulas.join(", ") || "ninguna"}`));
      lista.append(fila);
    }
    piezas.push(crear("p", "nota", `Sorteadas ${sorteadas.length} de ${mesas.length} mesa(s). Cualquiera con las mismas tres entradas obtiene el mismo resultado:`), lista);
    contenedor.replaceChildren(...piezas);
  } catch (error) {
    contenedor.replaceChildren(mensajeDeError(error));
  }
}

cargarInformePublicado();
if (nucleo) {
  for (const id of ["auditar", "investigar", "descargar-arbol", "sortear"]) {
    elemento(id).disabled = false;
  }
  elemento("auditar").addEventListener("click", auditarAhora);
  elemento("investigar").addEventListener("click", investigarAhora);
  elemento("descargar-arbol").addEventListener("click", descargarArbol);
  elemento("ronda-actual").addEventListener("click", usarRondaActual);
  elemento("ultimo-bloque").addEventListener("click", usarUltimoBloque);
  elemento("sortear").addEventListener("click", sortear);
  usarRondaActual();
}
