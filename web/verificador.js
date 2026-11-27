import {
  API_ES_LA_PUBLICADA,
  comprobacion,
  crear,
  elemento,
  fechaLegible,
  iniciarPagina,
  insignia,
  leerRaicesCompletas,
  leerRaicesDelRepositorio,
  mensaje,
  mensajeDeError,
  nombreArchivoRaiz,
  pedir,
} from "./comun.js";
import { examinarMesa, pintarExamen } from "./vista-acta.js";

const nucleo = await iniciarPagina();

function nombreDe(categoria) {
  return nucleo?.NOMBRES_CATEGORIAS[categoria] ?? categoria;
}

function dibujarTotales(totales) {
  const suma = Object.values(totales).reduce((acumulado, cantidad) => acumulado + cantidad, 0);
  return Object.entries(totales).map(([categoria, cantidad]) => {
    const fila = crear("div", "fila-voto");
    const nombre = crear("div", "nombre");
    nombre.append(crear("span", "", nombreDe(categoria)), crear("strong", "", String(cantidad)));
    const barra = crear("div", "barra");
    const relleno = crear("span");
    relleno.style.width = suma === 0 ? "0%" : `${(cantidad / suma) * 100}%`;
    barra.append(relleno);
    fila.append(nombre, barra);
    return fila;
  });
}

async function cargarResultados(raices) {
  const contenedor = elemento("resultados");
  try {
    const tablero = await pedir("/tablero");
    const ultimaFirmada = [...raices].reverse().find((raiz) => raiz.contenido.tipo === "raiz");
    const piezas = dibujarTotales(tablero.totales);
    if (!ultimaFirmada) {
      piezas.push(comprobacion(null, "Todavía no hay una raíz firmada con resultados"));
    } else if (ultimaFirmada.contenido.raiz_tablero === tablero.raiz_tablero) {
      piezas.push(comprobacion(true, `Coincide con la última raíz firmada (n.º ${ultimaFirmada.contenido.numero})`));
    } else {
      piezas.push(comprobacion(null, `Llegaron actas después de la última raíz firmada (n.º ${ultimaFirmada.contenido.numero})`, "El servidor publica una raíz nueva cada 10 minutos si hubo cambios."));
    }
    piezas.push(crear("p", "nota", "Raíz del tablero:"), crear("div", "huella", tablero.raiz_tablero));
    contenedor.replaceChildren(...piezas);
  } catch (error) {
    contenedor.replaceChildren(mensajeDeError(error));
  }
}

function compararConRepositorio(raiz, delRepositorio) {
  if (!API_ES_LA_PUBLICADA) {
    return null;
  }
  const copia = delRepositorio[raiz.contenido.numero];
  if (!copia) {
    return insignia("aviso", "Aún no está en el repositorio");
  }
  return copia.huella === raiz.huella ? insignia("ok", "Igual a la del repositorio") : insignia("mal", "Distinta de la del repositorio: hay dos versiones");
}

async function pintarCadena(raices) {
  const contenedor = elemento("cadena");
  if (raices.length === 0) {
    contenedor.replaceChildren(crear("p", "", "Todavía no hay raíces publicadas."));
    return;
  }
  const delRepositorio = API_ES_LA_PUBLICADA ? await leerRaicesDelRepositorio() : [];
  const esperada = delRepositorio[0]?.contenido.llave_publica_servidor ?? null;
  const resultado = await nucleo.verificarCadenaRaices(raices, esperada);
  const piezas = [
    comprobacion(resultado.valida, resultado.valida ? `Cadena válida · ${raices.length} raíces` : `Cadena rota en la n.º ${resultado.numero}: ${resultado.motivo}`),
  ];
  if (resultado.valida) {
    const origen = esperada ? "coincide con la génesis publicada en el repositorio" : "compárala con la publicada en el repositorio";
    piezas.push(crear("p", "nota", `Llave del servidor según la génesis (${origen}):`), crear("div", "huella", resultado.llavePublica));
  }
  if (API_ES_LA_PUBLICADA && !esperada) {
    piezas.push(mensaje("mal", "No se pudo leer la génesis del repositorio (raices/0000-genesis.json): la llave del servidor no quedó comparada con lo publicado."));
  }
  if (!API_ES_LA_PUBLICADA) {
    piezas.push(mensaje("aviso", "Estás usando un servidor local (plan B): sus raíces no se comparan con la carpeta raices/ del repositorio, que es del servidor en internet."));
  }
  const lista = crear("ul", "lista-simple");
  for (const raiz of [...raices].reverse()) {
    const fila = crear("li");
    const titulo = raiz.contenido.tipo === "genesis" ? "Génesis" : raiz.contenido.tipo === "rotacion" ? `Rotación de llave n.º ${raiz.contenido.numero}` : `Raíz n.º ${raiz.contenido.numero}`;
    fila.append(crear("strong", "", `${titulo} · ${fechaLegible(raiz.contenido.fecha)}`));
    const estadoRepositorio = compararConRepositorio(raiz, delRepositorio);
    if (estadoRepositorio) {
      fila.append(document.createTextNode(" "), estadoRepositorio);
    }
    if (raiz.contenido.totales) {
      const resumen = Object.entries(raiz.contenido.totales).map(([categoria, cantidad]) => `${nombreDe(categoria)}: ${cantidad}`).join(" · ");
      fila.append(crear("div", "nota", `${resumen} · ${raiz.contenido.renglones} renglones`));
    }
    fila.append(crear("div", "huella", raiz.huella));
    if (API_ES_LA_PUBLICADA && delRepositorio[raiz.contenido.numero]) {
      const sello = crear("a", "", "Sello de Bitcoin (.ots)");
      sello.href = `../raices/${nombreArchivoRaiz(raiz.contenido.numero, raiz.contenido.tipo)}.ots`;
      fila.append(sello);
    }
    lista.append(fila);
  }
  piezas.push(lista);
  contenedor.replaceChildren(...piezas);
}

async function cargarMesas() {
  const selector = elemento("mesas");
  const boton = elemento("comprobar");
  try {
    const { mesas } = await pedir("/mesas");
    selector.replaceChildren();
    if (mesas.length === 0) {
      selector.append(new Option("Aún no hay mesas con acta", ""));
      return;
    }
    for (const mesa of mesas) {
      selector.append(new Option(`Mesa ${mesa}`, mesa));
    }
    const pedida = new URLSearchParams(location.search).get("mesa");
    if (pedida && mesas.includes(pedida)) {
      selector.value = pedida;
    }
    boton.disabled = !nucleo;
    if (pedida && nucleo) {
      await comprobarMesa();
    }
  } catch (error) {
    selector.replaceChildren(new Option("No se pudo leer la lista de mesas", ""));
    elemento("resultado-mesa").replaceChildren(mensajeDeError(error));
  }
}

async function comprobarMesa() {
  const mesa = elemento("mesas").value;
  const contenedor = elemento("resultado-mesa");
  if (!mesa) {
    return;
  }
  contenedor.replaceChildren(mensaje("", `Comprobando la mesa ${mesa}…`));
  try {
    pintarExamen(nucleo, contenedor, await examinarMesa(nucleo, mesa));
  } catch (error) {
    contenedor.replaceChildren(mensajeDeError(error));
  }
}

elemento("comprobar").addEventListener("click", comprobarMesa);
if (nucleo) {
  let raices = [];
  try {
    raices = await leerRaicesCompletas();
    await pintarCadena(raices);
  } catch (error) {
    elemento("cadena").replaceChildren(mensajeDeError(error));
  }
  await Promise.all([cargarResultados(raices), cargarMesas()]);
} else {
  elemento("resultados").replaceChildren(mensaje("mal", "Sin el núcleo de verificación no se puede comprobar nada."));
  elemento("cadena").replaceChildren();
}
