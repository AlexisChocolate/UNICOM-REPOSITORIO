import Anthropic from "@anthropic-ai/sdk";
import { almacenCloudflare } from "../almacen/cloudflare.js";
import { archivosR2 } from "../almacen/archivos.js";
import { importarLlaveServidor, llaveVigenteDeCadena } from "../nucleo/index.js";
import { ErrorUnicom, Ventanilla } from "./ventanilla.js";
import { estadoTablero, leerEnteroDeConsulta, pruebaDeMesa } from "./lecturas.js";
import { atenderLectura } from "./lector.js";
import { bajarFoto, subirFoto } from "./fotos.js";
import {
  comprobarClaveAdmin,
  conCors,
  encabezadosCors,
  leerCuerpoJson,
  respuestaDeError,
  respuestaJson,
  TAMANO_MAXIMO_CUERPO,
} from "./http.js";

const VERSION = "0.2.0";
const TAMANO_MAXIMO_LECTURA = 8 * 1024 * 1024;
const ENCABEZADO_ADMIN_INTERNO = "x-unicom-admin-verificado";

async function cargarLlaves(env) {
  if (!env.LLAVE_SERVIDOR) {
    throw new ErrorUnicom(503, "llave_no_configurada", "Falta configurar el secreto LLAVE_SERVIDOR en el Worker");
  }
  const llaves = [];
  for (const nombre of ["LLAVE_SERVIDOR", "LLAVE_SERVIDOR_NUEVA"]) {
    if (!env[nombre]) {
      continue;
    }
    try {
      llaves.push(await importarLlaveServidor(env[nombre]));
    } catch {
      throw new ErrorUnicom(503, "llave_invalida", `El secreto ${nombre} no es una llave Ed25519 válida`);
    }
  }
  return llaves;
}

function clienteClaude(env) {
  // maxRetries 1: la mesa está esperando; si Claude no responde rápido, vale más "lectura pendiente".
  return env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 120000 }) : null;
}

export class VentanillaUnica {
  constructor(estadoDurable, env) {
    this.env = env;
    this.ventanilla = null;
  }

  async obtenerVentanilla() {
    if (!this.ventanilla) {
      this.ventanilla = new Ventanilla({
        almacen: almacenCloudflare(this.env.BASE),
        archivos: this.env.ARCHIVOS ? archivosR2(this.env.ARCHIVOS) : null,
        llaves: await cargarLlaves(this.env),
      });
    }
    return this.ventanilla;
  }

  async fetch(peticion) {
    try {
      const ventanilla = await this.obtenerVentanilla();
      const ruta = new URL(peticion.url).pathname;
      const comoAdministrador = peticion.headers.get(ENCABEZADO_ADMIN_INTERNO) === "si";
      const cuerpo = peticion.method === "POST" ? await leerCuerpoJson(peticion) : null;
      switch (ruta) {
        case "/actas": {
          const resultado = await ventanilla.recibirActa(cuerpo);
          return respuestaJson(resultado, resultado.repetida ? 200 : 201);
        }
        case "/autoridades":
          return respuestaJson(await ventanilla.registrarAutoridad(cuerpo), 201);
        case "/padron":
          return respuestaJson(await ventanilla.registrarEnPadron(cuerpo, { comoAdministrador }), 201);
        case "/reemplazos":
          return respuestaJson(await ventanilla.reemplazarLlave(cuerpo), 201);
        case "/opiniones":
          return respuestaJson(await ventanilla.registrarOpinion(cuerpo), 201);
        case "/decisiones":
          return respuestaJson(await ventanilla.registrarDecision(cuerpo), 201);
        case "/lecturas":
          return respuestaJson(await ventanilla.registrarLectura(cuerpo), 201);
        case "/raices":
          return respuestaJson(await ventanilla.publicarRaiz({ soloSiCambio: Boolean(cuerpo?.solo_si_cambio) }), 201);
        case "/rotar-llave": {
          const llaves = await cargarLlaves(this.env);
          if (llaves.length < 2) {
            throw new ErrorUnicom(400, "llave_nueva_no_configurada", "Configure primero el secreto LLAVE_SERVIDOR_NUEVA");
          }
          return respuestaJson(await ventanilla.rotarLlave({ llavePublicaNueva: llaves[1].llavePublica, motivo: cuerpo?.motivo }), 201);
        }
        default:
          throw new ErrorUnicom(404, "ruta_desconocida", `No existe ${ruta} en la ventanilla`);
      }
    } catch (error) {
      if (!(error instanceof ErrorUnicom)) {
        console.error("ventanilla", error);
      }
      return respuestaDeError(error);
    }
  }
}

function ventanillaRemota(env) {
  const objeto = env.VENTANILLA.get(env.VENTANILLA.idFromName("unica"));
  return {
    async pedir(ruta, cuerpo, { comoAdministrador = false } = {}) {
      const encabezados = { "content-type": "application/json" };
      if (comoAdministrador) {
        encabezados[ENCABEZADO_ADMIN_INTERNO] = "si";
      }
      return objeto.fetch(`https://ventanilla${ruta}`, { method: "POST", headers: encabezados, body: JSON.stringify(cuerpo ?? {}) });
    },
    async registrarLectura(lectura) {
      const respuesta = await this.pedir("/lecturas", lectura);
      const datos = await respuesta.json();
      if (!respuesta.ok) {
        throw new ErrorUnicom(respuesta.status, datos.error, datos.mensaje, datos.detalles);
      }
      return datos;
    },
  };
}

async function esAdministrador(peticion, env) {
  try {
    await comprobarClaveAdmin(peticion, env.CLAVE_ADMIN);
    return true;
  } catch {
    return false;
  }
}

async function bytesDelCuerpo(peticion, maximo) {
  const bytes = new Uint8Array(await peticion.arrayBuffer());
  if (bytes.length > maximo) {
    throw new ErrorUnicom(413, "cuerpo_muy_grande", `El cuerpo no puede pasar de ${maximo} bytes`);
  }
  return bytes;
}

const RUTAS_DE_ESCRITURA = {
  "/actas": { admin: false },
  "/padron": { admin: "opcional" },
  "/reemplazos": { admin: false },
  "/opiniones": { admin: false },
  "/decisiones": { admin: false },
  "/autoridades": { admin: true },
  "/raices": { admin: true },
  "/rotar-llave": { admin: true },
};

async function atender(peticion, env) {
  const url = new URL(peticion.url);
  const ruta = url.pathname.replace(/\/+$/, "") || "/";
  const metodo = peticion.method;
  const almacen = almacenCloudflare(env.BASE);
  const archivos = env.ARCHIVOS ? archivosR2(env.ARCHIVOS) : null;

  if (metodo === "GET" && ruta === "/") {
    return respuestaJson({ sistema: "UNICOM", version: VERSION, documentacion: "docs/API.md" });
  }
  if (metodo === "GET" && ruta === "/llave-servidor") {
    const raices = await almacen.leerRaices(0, 100000);
    const llaves = await cargarLlaves(env);
    const vigente = raices.length > 0 ? llaveVigenteDeCadena(raices) : llaves[0].llavePublica;
    return respuestaJson({ llave_publica: vigente, algoritmo: "Ed25519" });
  }
  if (metodo === "GET" && ruta === "/tablero") {
    return respuestaJson(await estadoTablero(almacen));
  }
  if (metodo === "GET" && ruta === "/mesas") {
    return respuestaJson({ mesas: await almacen.listarMesas() });
  }
  const coincidenciaMesa = ruta.match(/^\/actas\/(\d{6})$/);
  if (metodo === "GET" && coincidenciaMesa) {
    return respuestaJson(await pruebaDeMesa(almacen, coincidenciaMesa[1]));
  }
  if (metodo === "GET" && ruta === "/cuaderno") {
    const desde = leerEnteroDeConsulta(url, "desde", 1, 1, Number.MAX_SAFE_INTEGER);
    const limite = leerEnteroDeConsulta(url, "limite", 100, 1, 500);
    return respuestaJson({ renglones: await almacen.leerRenglones(desde, limite) });
  }
  const coincidenciaRecibo = ruta.match(/^\/recibos\/(\d{1,15})$/);
  if (metodo === "GET" && coincidenciaRecibo) {
    const recibo = await almacen.leerRecibo(Number(coincidenciaRecibo[1]));
    if (!recibo) {
      throw new ErrorUnicom(404, "recibo_inexistente", "No hay recibo para ese renglón");
    }
    return respuestaJson(recibo);
  }
  if (metodo === "GET" && ruta === "/raices") {
    const desde = leerEnteroDeConsulta(url, "desde", 0, 0, Number.MAX_SAFE_INTEGER);
    const limite = leerEnteroDeConsulta(url, "limite", 100, 1, 500);
    return respuestaJson({ raices: await almacen.leerRaices(desde, limite) });
  }
  if (metodo === "GET" && ruta === "/fotos") {
    const desde = url.searchParams.get("desde") ?? "";
    const limite = leerEnteroDeConsulta(url, "limite", 100, 1, 500);
    return respuestaJson({ fotos: await almacen.listarFotos(desde, limite) });
  }
  const coincidenciaFoto = ruta.match(/^\/fotos\/([0-9a-f]{64})$/);
  if (metodo === "GET" && coincidenciaFoto) {
    if (!archivos) {
      throw new ErrorUnicom(503, "fotos_no_configuradas", "El Worker no tiene la cubeta R2 de fotos");
    }
    const foto = await bajarFoto({ huella: coincidenciaFoto[1], almacen, archivos });
    return new Response(foto.bytes, {
      headers: { "content-type": foto.tipo, "cache-control": "public, max-age=31536000, immutable" },
    });
  }
  const coincidenciaVolcado = ruta.match(/^\/volcados\/(raiz-\d{6}\.json)$/);
  if (metodo === "GET" && coincidenciaVolcado) {
    const volcado = archivos ? await archivos.leer(`volcados/${coincidenciaVolcado[1]}`) : null;
    if (!volcado) {
      throw new ErrorUnicom(404, "volcado_inexistente", "No hay volcado para esa raíz");
    }
    return new Response(volcado.bytes, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" },
    });
  }
  if (metodo === "POST" && ruta === "/fotos") {
    if (!archivos) {
      throw new ErrorUnicom(503, "fotos_no_configuradas", "El Worker no tiene la cubeta R2 de fotos");
    }
    const resultado = await subirFoto({
      bytes: await bytesDelCuerpo(peticion, 10 * 1024 * 1024),
      tipo: (peticion.headers.get("content-type") ?? "").split(";")[0].trim(),
      llavePublica: peticion.headers.get("x-unicom-llave"),
      firma: peticion.headers.get("x-unicom-firma"),
      almacen,
      archivos,
      ahora: new Date(),
    });
    return respuestaJson(resultado, resultado.ya_existia ? 200 : 201);
  }
  if (metodo === "POST" && ruta === "/lector") {
    const texto = new TextDecoder().decode(await bytesDelCuerpo(peticion, TAMANO_MAXIMO_LECTURA));
    let cuerpo;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      throw new ErrorUnicom(400, "json_invalido", "El cuerpo no es un JSON válido");
    }
    const resultado = await atenderLectura({
      cuerpo,
      almacen,
      ventanilla: ventanillaRemota(env),
      cliente: clienteClaude(env),
      ahora: new Date(),
    });
    return respuestaJson(resultado);
  }
  if (metodo === "POST" && RUTAS_DE_ESCRITURA[ruta]) {
    const regla = RUTAS_DE_ESCRITURA[ruta].admin;
    if (regla === true) {
      await comprobarClaveAdmin(peticion, env.CLAVE_ADMIN);
    }
    const comoAdministrador = regla === true || (regla === "opcional" && (await esAdministrador(peticion, env)));
    const texto = await peticion.text();
    if (texto.length > TAMANO_MAXIMO_CUERPO) {
      throw new ErrorUnicom(413, "cuerpo_muy_grande", `El cuerpo no puede pasar de ${TAMANO_MAXIMO_CUERPO} bytes`);
    }
    let cuerpo;
    try {
      cuerpo = texto ? JSON.parse(texto) : {};
    } catch {
      throw new ErrorUnicom(400, "json_invalido", "El cuerpo no es un JSON válido");
    }
    return ventanillaRemota(env).pedir(ruta, cuerpo, { comoAdministrador });
  }
  throw new ErrorUnicom(404, "ruta_desconocida", `No existe ${metodo} ${ruta}`);
}

export default {
  async fetch(peticion, env) {
    const cors = encabezadosCors(peticion, env.ORIGENES_PERMITIDOS);
    if (peticion.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      return conCors(await atender(peticion, env), cors);
    } catch (error) {
      if (!(error instanceof ErrorUnicom)) {
        console.error("worker", error);
      }
      return conCors(respuestaDeError(error), cors);
    }
  },

  // Publicación periódica de la raíz (Paso 9): solo si el cuaderno creció desde la última.
  async scheduled(evento, env, contexto) {
    contexto.waitUntil(
      ventanillaRemota(env)
        .pedir("/raices", { solo_si_cambio: true }, { comoAdministrador: true })
        .then(async (respuesta) => {
          if (!respuesta.ok) {
            console.error("raiz programada", respuesta.status, await respuesta.text());
          }
        }),
    );
  },
};
