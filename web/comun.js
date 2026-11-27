export const API_PUBLICADA = "https://unicom-api.myk-unicom.workers.dev";
export const API_LOCAL = "http://127.0.0.1:8787";

const CLAVE_API_ELEGIDA = "unicom-api";
const PATRON_API_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/;

// Solo se acepta el Worker publicado o uno en esta misma computadora (plan B): un enlace con ?api= de otro
// servidor podría desviar las actas y la clave de registro a un impostor (regla 4).
export function apiPermitida(direccion) {
  return direccion === API_PUBLICADA || PATRON_API_LOCAL.test(direccion);
}

function elegirApi() {
  const pedida = new URLSearchParams(location.search).get("api");
  let rechazada = null;
  if (pedida === "auto") {
    localStorage.removeItem(CLAVE_API_ELEGIDA);
  } else if (pedida) {
    const limpia = pedida.replace(/\/+$/, "");
    if (apiPermitida(limpia)) {
      localStorage.setItem(CLAVE_API_ELEGIDA, limpia);
    } else {
      rechazada = pedida;
    }
  }
  const guardada = localStorage.getItem(CLAVE_API_ELEGIDA);
  if (guardada && !apiPermitida(guardada)) {
    localStorage.removeItem(CLAVE_API_ELEGIDA);
  }
  if (guardada && apiPermitida(guardada)) {
    return { direccion: guardada, rechazada };
  }
  return { direccion: ["localhost", "127.0.0.1"].includes(location.hostname) ? API_LOCAL : API_PUBLICADA, rechazada };
}

const ELECCION_API = elegirApi();

export const API = ELECCION_API.direccion;

export const API_RECHAZADA = ELECCION_API.rechazada;

// Las raíces de la carpeta raices/ del repositorio son las del servidor publicado; contra el plan B local no aplican.
export const API_ES_LA_PUBLICADA = API === API_PUBLICADA;

export class ErrorDeApi extends Error {
  constructor(estado, codigo, mensaje, detalles) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

export async function pedir(ruta, { metodo = "GET", cuerpo, encabezados = {}, crudo = false } = {}) {
  const todos = { ...encabezados };
  if (cuerpo !== undefined && !crudo) {
    todos["content-type"] = "application/json";
  }
  let respuesta;
  try {
    respuesta = await fetch(API + ruta, {
      method: metodo,
      headers: todos,
      body: cuerpo === undefined ? undefined : crudo ? cuerpo : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorDeApi(0, "sin_conexion", `No hay conexión con el servidor (${API})`);
  }
  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    datos = null;
  }
  if (!respuesta.ok) {
    throw new ErrorDeApi(respuesta.status, datos?.error ?? "error_http", datos?.mensaje ?? `El servidor respondió ${respuesta.status}`, datos?.detalles);
  }
  return datos;
}

export async function leerCuadernoCompleto() {
  const renglones = [];
  for (;;) {
    const { renglones: pagina } = await pedir(`/cuaderno?desde=${renglones.length + 1}&limite=500`);
    renglones.push(...pagina);
    if (pagina.length < 500) {
      return renglones;
    }
  }
}

export async function leerRaicesCompletas() {
  const raices = [];
  for (;;) {
    const { raices: pagina } = await pedir(`/raices?desde=${raices.length}&limite=500`);
    raices.push(...pagina);
    if (pagina.length < 500) {
      return raices;
    }
  }
}

export function nombreArchivoRaiz(numero, tipo) {
  const relleno = String(numero).padStart(4, "0");
  return tipo === "genesis" ? `${relleno}-genesis.json` : `${relleno}.json`;
}

// Se leen del repositorio (el "periódico", Paso 9), no del Worker: si el servidor mintiera, estas no cambian.
export async function leerRaicesDelRepositorio(maximo = 10000) {
  const raices = [];
  for (let numero = 0; numero < maximo; numero++) {
    const nombre = nombreArchivoRaiz(numero, numero === 0 ? "genesis" : "raiz");
    let respuesta;
    try {
      respuesta = await fetch(`../raices/${nombre}`, { cache: "no-store" });
    } catch {
      break;
    }
    if (!respuesta.ok) {
      break;
    }
    raices.push(await respuesta.json());
  }
  return raices;
}

// La llave de confianza del servidor sale de la génesis (arquitectura, sec. 5.3), nunca de GET /llave-servidor.
// Con el Worker publicado, la génesis de referencia es la del repositorio: si el servidor no la muestra o muestra
// otra, no se le cree. En el plan B local no hay repositorio que comparar y se usa la génesis del propio servidor.
// Devuelve `confiable: true` solo cuando la llave quedó cruzada con lo publicado (o es el plan B con génesis).
export async function cadenaConfiable(nucleo) {
  const raices = await leerRaicesCompletas();
  let esperada = null;
  if (API_ES_LA_PUBLICADA) {
    const [genesisRepositorio] = await leerRaicesDelRepositorio(1);
    if (!genesisRepositorio) {
      return { llave: null, raices, ultimaFirmada: null, confiable: false, origen: "repositorio", aviso: "No se pudo leer raices/0000-genesis.json del repositorio: no hay contra qué comprobar al servidor." };
    }
    esperada = genesisRepositorio.contenido.llave_publica_servidor;
    if (raices.length === 0) {
      return { llave: null, raices, ultimaFirmada: null, confiable: false, origen: "génesis del repositorio", aviso: "ALERTA: el repositorio tiene génesis publicada, pero el servidor no muestra ninguna raíz." };
    }
  } else if (raices.length === 0) {
    return { llave: null, raices, ultimaFirmada: null, confiable: false, origen: "servidor local", aviso: "El servidor local todavía no publicó su génesis: no hay llave de confianza." };
  }
  const cadena = await nucleo.verificarCadenaRaices(raices, esperada);
  const origen = esperada ? "génesis del repositorio" : "génesis del servidor local (plan B)";
  if (!cadena.valida) {
    return { llave: null, raices, ultimaFirmada: null, confiable: false, origen, aviso: `ALERTA: la cadena de raíces no es válida en la n.º ${cadena.numero}: ${cadena.motivo}` };
  }
  const ultimaFirmada = [...raices].reverse().find((raiz) => raiz.contenido.tipo === "raiz") ?? null;
  return { llave: cadena.llaveVigente, raices, ultimaFirmada, confiable: true, origen, aviso: null };
}

// La prueba de inclusión vale contra una raíz FIRMADA, no contra la que el servidor dice tener ahora.
export function estadoDeLaRaiz(raizDeLaPrueba, cadena) {
  if (!cadena.confiable) {
    return { estado: false, titulo: "No se pudo cruzar la raíz con una raíz firmada", detalle: cadena.aviso };
  }
  if (!cadena.ultimaFirmada) {
    return { estado: null, titulo: "Todavía no hay una raíz firmada con actas", detalle: "El servidor publica una raíz cada 10 minutos si hubo cambios." };
  }
  if (cadena.ultimaFirmada.contenido.raiz_tablero === raizDeLaPrueba) {
    return { estado: true, titulo: `La raíz de la prueba es la raíz firmada n.º ${cadena.ultimaFirmada.contenido.numero}`, detalle: `Firma comprobada con la llave de la ${cadena.origen}.` };
  }
  return { estado: null, titulo: "La raíz de la prueba todavía no está firmada", detalle: `Llegaron actas después de la raíz firmada n.º ${cadena.ultimaFirmada.contenido.numero}. Vuelve a comprobar cuando se publique la siguiente (cada 10 minutos).` };
}

export async function cargarNucleo() {
  return import("../nucleo/index.js");
}

export function crear(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta);
  if (clase) {
    elemento.className = clase;
  }
  if (texto !== undefined && texto !== null) {
    elemento.textContent = texto;
  }
  return elemento;
}

export function elemento(id) {
  return document.getElementById(id);
}

function lineasDeDetalles(detalles) {
  if (Array.isArray(detalles)) {
    return detalles.map((detalle) => (typeof detalle === "string" ? detalle : JSON.stringify(detalle)));
  }
  if (detalles && typeof detalles === "object") {
    return Object.entries(detalles).map(([clave, valor]) => `${clave}: ${typeof valor === "string" ? valor : JSON.stringify(valor)}`);
  }
  return [];
}

export function mensaje(tipo, texto, detalles) {
  const caja = crear("div", `mensaje ${tipo}`);
  caja.setAttribute("role", tipo === "mal" ? "alert" : "status");
  caja.append(crear("div", "", texto));
  const lineas = lineasDeDetalles(detalles);
  if (lineas.length > 0) {
    const lista = crear("ul");
    lista.append(...lineas.map((linea) => crear("li", "", linea)));
    caja.append(lista);
  }
  return caja;
}

export function mensajeDeError(error) {
  return mensaje("mal", error.message, error.detalles);
}

export function comprobacion(estado, titulo, detalle) {
  const tipo = estado === true ? "ok" : estado === false ? "mal" : "aviso";
  const marca = tipo === "ok" ? "✓" : tipo === "mal" ? "✗" : "!";
  const caja = crear("div", `comprobacion ${tipo}`);
  const texto = crear("div");
  texto.append(crear("strong", "", titulo));
  if (detalle) {
    texto.append(crear("small", "", detalle));
  }
  caja.append(crear("span", "marca", marca), texto);
  return caja;
}

export function insignia(tipo, texto) {
  return crear("span", `insignia ${tipo}`, texto);
}

export function textoCorto(huella, largo = 12) {
  return typeof huella === "string" && huella.length > largo * 2 ? `${huella.slice(0, largo)}…${huella.slice(-6)}` : String(huella ?? "");
}

export function fechaLegible(iso) {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? String(iso) : fecha.toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "medium" });
}

// Hora declarada del celular, con su desfase (Perú: -05:00), en el formato que acepta validarPaquete.
export function fechaLocalIso(fecha = new Date()) {
  const desfase = -fecha.getTimezoneOffset();
  const signo = desfase >= 0 ? "+" : "-";
  const relleno = (numero) => String(Math.floor(Math.abs(numero))).padStart(2, "0");
  const local = new Date(fecha.getTime() + desfase * 60000);
  return `${local.toISOString().slice(0, 19)}${signo}${relleno(desfase / 60)}:${relleno(desfase % 60)}`;
}

// El JSON canónico solo admite ASCII (Paso 5): las tildes se quitan antes de firmar un motivo.
export function quitarTildes(texto) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ñ/g, "n").replace(/Ñ/g, "N");
}

export function esAsciiImprimible(texto) {
  return /^[\x20-\x7e]*$/.test(texto);
}

export async function bytesDeArchivo(archivo) {
  return new Uint8Array(await archivo.arrayBuffer());
}

// Cualquier copia de la foto sirve si su huella coincide con la sellada (Paso 6).
export async function fotoVerificada(nucleo, huellaEsperada) {
  const respuesta = await fetch(`${API}/fotos/${huellaEsperada}`).catch(() => null);
  if (!respuesta || !respuesta.ok) {
    return { encontrada: false };
  }
  const bytes = new Uint8Array(await respuesta.arrayBuffer());
  const coincide = (await nucleo.huellaHex(bytes)) === huellaEsperada;
  const tipo = respuesta.headers.get("content-type") ?? "image/jpeg";
  return { encontrada: true, coincide, url: URL.createObjectURL(new Blob([bytes], { type: tipo })) };
}

const NOMBRE_BASE = "unicom";
const ALMACENES = ["llaves", "pendientes"];

function abrirBase() {
  return new Promise((resolver, rechazar) => {
    const pedido = indexedDB.open(NOMBRE_BASE, 1);
    pedido.onupgradeneeded = () => {
      for (const nombre of ALMACENES) {
        if (!pedido.result.objectStoreNames.contains(nombre)) {
          pedido.result.createObjectStore(nombre);
        }
      }
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
  });
}

async function operar(almacen, modo, operacion) {
  const base = await abrirBase();
  return new Promise((resolver, rechazar) => {
    const transaccion = base.transaction(almacen, modo);
    const pedido = operacion(transaccion.objectStore(almacen));
    transaccion.oncomplete = () => resolver(pedido.result);
    transaccion.onerror = () => rechazar(transaccion.error);
  });
}

// IndexedDB guarda la CryptoKey no exportable tal cual: el navegador la conserva sin que la llave privada salga nunca (sec. 5.1).
export function guardarEnBase(almacen, clave, valor) {
  return operar(almacen, "readwrite", (tienda) => tienda.put(valor, clave));
}

export function leerDeBase(almacen, clave) {
  return operar(almacen, "readonly", (tienda) => tienda.get(clave));
}

export function borrarDeBase(almacen, clave) {
  return operar(almacen, "readwrite", (tienda) => tienda.delete(clave));
}

export function listarDeBase(almacen) {
  return operar(almacen, "readonly", (tienda) => tienda.getAll());
}

export function leerLista(clave) {
  try {
    return JSON.parse(localStorage.getItem(clave) ?? "[]");
  } catch {
    return [];
  }
}

export function agregarALista(clave, valor) {
  const lista = leerLista(clave);
  lista.push(valor);
  localStorage.setItem(clave, JSON.stringify(lista));
  return lista;
}

export function pintarEstadoConexion(contenedor, nucleoCargado) {
  contenedor.replaceChildren(
    nucleoCargado ? insignia("ok", "Verificación activa en este navegador") : insignia("mal", "No se pudo cargar el núcleo de verificación"),
    insignia(API_ES_LA_PUBLICADA ? "" : "aviso", API_ES_LA_PUBLICADA ? "Servidor: en internet" : `Servidor local (plan B): ${API}`),
  );
  if (API_RECHAZADA) {
    contenedor.append(mensaje("mal", `Se ignoró el servidor del enlace (${API_RECHAZADA}): UNICOM solo habla con su servidor publicado o con uno en esta misma computadora. Si alguien te mandó ese enlace, avísalo.`));
  }
}

export async function iniciarPagina() {
  const estado = elemento("estado-conexion");
  try {
    const nucleo = await cargarNucleo();
    pintarEstadoConexion(estado, true);
    return nucleo;
  } catch (error) {
    console.error(error);
    pintarEstadoConexion(estado, false);
    estado.append(mensaje("mal", "Este navegador no pudo cargar el verificador. Usa un Chrome o Edge actual."));
    return null;
  }
}
