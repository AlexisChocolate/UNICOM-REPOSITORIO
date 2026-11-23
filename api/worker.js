import { almacenCloudflare } from "../almacen/cloudflare.js";
import { importarLlaveServidor } from "../nucleo/index.js";
import { ErrorUnicom, Ventanilla } from "./ventanilla.js";
import { estadoTablero, leerEnteroDeConsulta, pruebaDeMesa } from "./lecturas.js";
import { comprobarClaveAdmin, conCors, encabezadosCors, leerCuerpoJson, respuestaDeError, respuestaJson } from "./http.js";

const VERSION = "0.1.0";

async function cargarLlaveServidor(env) {
  if (!env.LLAVE_SERVIDOR) {
    throw new ErrorUnicom(503, "llave_no_configurada", "Falta configurar el secreto LLAVE_SERVIDOR en el Worker");
  }
  try {
    return await importarLlaveServidor(env.LLAVE_SERVIDOR);
  } catch {
    throw new ErrorUnicom(503, "llave_invalida", "El secreto LLAVE_SERVIDOR no es una llave Ed25519 válida");
  }
}

export class VentanillaUnica {
  constructor(estadoDurable, env) {
    this.env = env;
    this.ventanilla = null;
  }

  async obtenerVentanilla() {
    if (!this.ventanilla) {
      const { llavePrivada, llavePublica } = await cargarLlaveServidor(this.env);
      this.ventanilla = new Ventanilla({ almacen: almacenCloudflare(this.env.BASE), llavePrivada, llavePublica });
    }
    return this.ventanilla;
  }

  async fetch(peticion) {
    try {
      const ventanilla = await this.obtenerVentanilla();
      const ruta = new URL(peticion.url).pathname;
      if (ruta === "/actas") {
        const resultado = await ventanilla.recibirActa(await leerCuerpoJson(peticion));
        return respuestaJson(resultado, resultado.repetida ? 200 : 201);
      }
      if (ruta === "/padron") {
        return respuestaJson(await ventanilla.registrarEnPadron(await leerCuerpoJson(peticion)), 201);
      }
      if (ruta === "/raices") {
        return respuestaJson(await ventanilla.publicarRaiz(), 201);
      }
      throw new ErrorUnicom(404, "ruta_desconocida", `No existe ${ruta} en la ventanilla`);
    } catch (error) {
      if (!(error instanceof ErrorUnicom)) {
        console.error("ventanilla", error);
      }
      return respuestaDeError(error);
    }
  }
}

function enviarAVentanilla(env, peticion) {
  const identificador = env.VENTANILLA.idFromName("unica");
  return env.VENTANILLA.get(identificador).fetch(peticion);
}

async function atender(peticion, env) {
  const url = new URL(peticion.url);
  const ruta = url.pathname.replace(/\/+$/, "") || "/";
  const metodo = peticion.method;
  const almacen = almacenCloudflare(env.BASE);

  if (metodo === "GET" && ruta === "/") {
    return respuestaJson({ sistema: "UNICOM", version: VERSION, documentacion: "docs/API.md" });
  }
  if (metodo === "GET" && ruta === "/llave-servidor") {
    const { llavePublica } = await cargarLlaveServidor(env);
    return respuestaJson({ llave_publica: llavePublica, algoritmo: "Ed25519" });
  }
  if (metodo === "GET" && ruta === "/tablero") {
    return respuestaJson(await estadoTablero(almacen));
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
  if (metodo === "POST" && ruta === "/actas") {
    return enviarAVentanilla(env, peticion);
  }
  if (metodo === "POST" && (ruta === "/padron" || ruta === "/raices")) {
    await comprobarClaveAdmin(peticion, env.CLAVE_ADMIN);
    return enviarAVentanilla(env, peticion);
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
};
