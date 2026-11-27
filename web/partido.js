import {
  comprobacion,
  crear,
  elemento,
  esAsciiImprimible,
  guardarEnBase,
  iniciarPagina,
  leerCuadernoCompleto,
  leerDeBase,
  mensaje,
  mensajeDeError,
  pedir,
  quitarTildes,
} from "./comun.js";
import { examinarMesa, pintarExamen } from "./vista-acta.js";

const CLAVE_LLAVE = "personero";

const nucleo = await iniciarPagina();

const estado = { llave: null, examen: null };

function pintarLlave() {
  const contenedor = elemento("llave-estado");
  if (!estado.llave) {
    contenedor.replaceChildren(mensaje("aviso", "Todavía no hay una llave del partido en este navegador."));
    return;
  }
  contenedor.replaceChildren(
    comprobacion(true, `Llave de personero de ${nucleo.NOMBRES_CATEGORIAS[estado.llave.partido]}`),
    crear("div", "huella", estado.llave.llavePublica),
  );
}

async function comprobarLlave() {
  pintarLlave();
  if (!estado.llave) {
    return false;
  }
  const contenedor = elemento("llave-estado");
  try {
    const reconstruido = await nucleo.reconstruirEstado(await leerCuadernoCompleto());
    const registro = reconstruido.padron.get(estado.llave.llavePublica);
    const autoridad = reconstruido.autoridades.get(estado.llave.llavePublica);
    if (autoridad) {
      contenedor.append(comprobacion(true, `Es la llave de la autoridad ${autoridad.nombre}`));
      return true;
    }
    if (registro && !reconstruido.reemplazadas.has(estado.llave.llavePublica)) {
      const detalle = registro.provisional ? "registro provisional del piloto" : "firmado por el partido o la ONPE";
      contenedor.append(comprobacion(true, `Está en el padrón como ${registro.rol}`, `Renglón ${registro.renglon} (${detalle}).`));
      return true;
    }
    contenedor.append(comprobacion(false, "La llave NO está en el padrón", "El servidor rechazará tu firma hasta que el partido o la ONPE la registren."));
    return false;
  } catch (error) {
    contenedor.append(mensajeDeError(error));
    return false;
  }
}

async function crearLlave() {
  if (estado.llave && !confirm("Ya hay una llave del partido en este navegador. ¿Crear otra?")) {
    return;
  }
  let par;
  try {
    par = await nucleo.generarLlaveNoExportable();
  } catch {
    elemento("llave-estado").replaceChildren(mensaje("mal", "Este navegador no permite firmas Ed25519 con Web Crypto. Usa un Chrome actual."));
    return;
  }
  estado.llave = { partido: elemento("partido").value, llavePublica: await nucleo.llavePublicaHex(par.publicKey), par };
  await guardarEnBase("llaves", CLAVE_LLAVE, estado.llave);
  await comprobarLlave();
}

async function registrarProvisional() {
  const contenedor = elemento("registro-resultado");
  const campoClave = elemento("clave-admin");
  const clave = campoClave.value.trim();
  campoClave.value = "";
  if (!estado.llave || !clave) {
    contenedor.replaceChildren(mensaje("mal", "Necesitas la llave del partido y la clave de administración."));
    return;
  }
  try {
    const entrada = { rol: "personero", mesa: null, partido: estado.llave.partido, llave_publica: estado.llave.llavePublica };
    const respuesta = await pedir("/padron", { metodo: "POST", cuerpo: entrada, encabezados: { authorization: `Bearer ${clave}` } });
    contenedor.replaceChildren(mensaje("ok", `Personero registrado en el renglón ${respuesta.renglon} (provisional).`));
    await comprobarLlave();
  } catch (error) {
    contenedor.replaceChildren(mensajeDeError(error));
  }
}

async function cargarMesas() {
  const selector = elemento("mesas");
  try {
    const { mesas } = await pedir("/mesas");
    selector.replaceChildren(...(mesas.length === 0 ? [new Option("Aún no hay mesas con acta", "")] : mesas.map((mesa) => new Option(`Mesa ${mesa}`, mesa))));
    elemento("revisar").disabled = mesas.length === 0;
  } catch (error) {
    selector.replaceChildren(new Option("No se pudo leer la lista de mesas", ""));
    elemento("resultado-mesa").replaceChildren(mensajeDeError(error));
  }
}

async function revisarMesa() {
  const mesa = elemento("mesas").value;
  const contenedor = elemento("resultado-mesa");
  if (!mesa) {
    return;
  }
  contenedor.replaceChildren(mensaje("", `Revisando la mesa ${mesa}…`));
  estado.examen = null;
  elemento("firmar-opinion").disabled = true;
  try {
    estado.examen = await examinarMesa(nucleo, mesa);
    pintarExamen(nucleo, contenedor, estado.examen);
    elemento("firmar-opinion").disabled = false;
    elemento("opinion-resultado").replaceChildren(mensaje("", `Tu opinión irá sobre el acta vigente de la mesa ${mesa}.`));
  } catch (error) {
    contenedor.replaceChildren(mensajeDeError(error));
  }
}

async function firmarOpinion() {
  const contenedor = elemento("opinion-resultado");
  if (!estado.llave) {
    contenedor.replaceChildren(mensaje("mal", "Primero crea la llave del partido."));
    return;
  }
  if (!estado.examen) {
    contenedor.replaceChildren(mensaje("mal", "Primero revisa una mesa."));
    return;
  }
  const motivo = quitarTildes(elemento("motivo").value.trim()).replace(/\s+/g, " ");
  if (motivo.length < 1 || motivo.length > 200 || !esAsciiImprimible(motivo)) {
    contenedor.replaceChildren(mensaje("mal", "El motivo debe tener de 1 a 200 caracteres, sin emojis ni símbolos especiales."));
    return;
  }
  const contenido = {
    tipo: elemento("tipo-opinion").value,
    mesa: estado.examen.datos.mesa,
    huella_acta: estado.examen.datos.huella_acta,
    motivo,
  };
  try {
    const firmado = await nucleo.firmarObjeto(estado.llave.par.privateKey, estado.llave.llavePublica, contenido);
    const respuesta = await pedir("/opiniones", { metodo: "POST", cuerpo: firmado });
    const sobreVigente = respuesta.sobre_acta_vigente ? "sobre el acta vigente" : "sobre un acta que ya fue corregida";
    contenedor.replaceChildren(mensaje("ok", `${contenido.tipo === "objecion" ? "Objeción" : "Respaldo"} firmado y anotado en el renglón ${respuesta.renglon} (${sobreVigente}).`, [`Texto firmado: "${motivo}"`]));
    elemento("motivo").value = "";
    await revisarMesa();
  } catch (error) {
    contenedor.replaceChildren(mensajeDeError(error));
  }
}

if (nucleo) {
  const partidos = nucleo.CATEGORIAS.filter((categoria) => /^P\d{2}$/.test(categoria));
  elemento("partido").replaceChildren(...partidos.map((partido) => new Option(nucleo.NOMBRES_CATEGORIAS[partido], partido)));
  elemento("partido").value = partidos.includes("P02") ? "P02" : partidos[0];
  const guardada = await leerDeBase("llaves", CLAVE_LLAVE).catch(() => null);
  if (guardada?.par) {
    estado.llave = guardada;
    elemento("partido").value = guardada.partido;
    comprobarLlave();
  } else {
    pintarLlave();
  }
  elemento("crear-llave").addEventListener("click", crearLlave);
  elemento("comprobar-llave").addEventListener("click", comprobarLlave);
  elemento("registrar-provisional").addEventListener("click", registrarProvisional);
  elemento("revisar").addEventListener("click", revisarMesa);
  elemento("firmar-opinion").addEventListener("click", firmarOpinion);
  await cargarMesas();
}
