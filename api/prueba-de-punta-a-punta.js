// Recorre el camino completo contra un Worker ya levantado (local o desplegado):
// padrón -> acta firmada -> recibo -> prueba de inclusión -> raíz publicada -> cadena verificada.
//
//   $env:CLAVE_ADMIN = "..."          (PowerShell; la misma clave guardada como secreto del Worker)
//   node api/prueba-de-punta-a-punta.js https://unicom-api.<subdominio>.workers.dev [mesa]
import {
  firmarHuella,
  generarLlaveNoExportable,
  huellaActa,
  huellaHex,
  llavePublicaHex,
  verificarCadenaRaices,
  verificarDocumento,
  verificarInclusion,
} from "../nucleo/index.js";

const direccion = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const mesa = process.argv[3] ?? "045123";
const claveAdmin = process.env.CLAVE_ADMIN;

async function pedir(metodo, ruta, cuerpo, conAdmin = false) {
  const encabezados = { "content-type": "application/json" };
  if (conAdmin) {
    encabezados.authorization = `Bearer ${claveAdmin}`;
  }
  const respuesta = await fetch(direccion + ruta, {
    method: metodo,
    headers: encabezados,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const datos = await respuesta.json();
  return { estado: respuesta.status, datos };
}

function exigir(condicion, mensaje, datos) {
  if (!condicion) {
    throw new Error(`${mensaje}\n${JSON.stringify(datos, null, 2)}`);
  }
}

async function principal() {
  exigir(claveAdmin, "Falta la variable de entorno CLAVE_ADMIN", {});

  const llaveServidor = await pedir("GET", "/llave-servidor");
  exigir(llaveServidor.estado === 200, "No se pudo leer la llave del servidor", llaveServidor.datos);
  const llavePublicaServidor = llaveServidor.datos.llave_publica;
  console.log(`Llave pública del servidor: ${llavePublicaServidor}`);

  const llavesRosa = await generarLlaveNoExportable();
  const llavePublicaRosa = await llavePublicaHex(llavesRosa.publicKey);
  const registro = await pedir("POST", "/padron", { rol: "miembro", mesa, llave_publica: llavePublicaRosa }, true);
  exigir(registro.estado === 201, "No se pudo registrar a Rosa en el padrón", registro.datos);
  console.log(`Rosa quedó en el padrón de la mesa ${mesa} (renglón ${registro.datos.renglon})`);

  const anterior = await pedir("GET", `/actas/${mesa}`);
  const reemplazaA = anterior.estado === 200 ? anterior.datos.huella_acta : null;
  const paquete = {
    mesa,
    votos: { P01: 120, P02: 80 + Math.floor(Math.random() * 20), blancos: 6, nulos: 4, impugnados: 1 },
    foto_sha256: await huellaHex(new TextEncoder().encode(`foto del acta ${mesa}, Juliaca`)),
    precinto_sha256: null,
    precinto_numero: null,
    fecha_hora_declarada: new Date().toISOString(),
    personeros_presentes: false,
    reemplaza_a: reemplazaA,
  };
  const huellaDelActa = await huellaActa(paquete);
  const firma = await firmarHuella(llavesRosa.privateKey, huellaDelActa);
  const envio = await pedir("POST", "/actas", { paquete, firmas: [{ rol: "miembro", llave_publica: llavePublicaRosa, firma }] });
  exigir(envio.estado === 201, "El servidor no aceptó el acta", envio.datos);
  const recibo = envio.datos.recibo;
  exigir(await verificarDocumento(recibo, llavePublicaServidor), "La firma del recibo no es válida", recibo);
  exigir(recibo.contenido.huella_acta === huellaDelActa, "El recibo no es de esta acta", recibo);
  console.log(`Acta ${mesa} anotada en el renglón ${recibo.contenido.renglon}; recibo firmado y verificado`);
  if (reemplazaA) {
    console.log(`(corrige al acta anterior ${reemplazaA.slice(0, 16)}...)`);
  }

  const prueba = await pedir("GET", `/actas/${mesa}`);
  exigir(prueba.estado === 200, "No se pudo leer la prueba de inclusión", prueba.datos);
  const incluida = await verificarInclusion({
    casillero: prueba.datos.casillero,
    huellaActa: prueba.datos.huella_acta,
    sumas: prueba.datos.sumas,
    hermanos: prueba.datos.hermanos,
    raiz: prueba.datos.raiz,
  });
  exigir(incluida && prueba.datos.huella_acta === huellaDelActa, "La prueba de inclusión no cuadra", prueba.datos);
  console.log(`Prueba de inclusión verificada hasta la raíz ${prueba.datos.raiz.huella.slice(0, 16)}...`);

  const publicacion = await pedir("POST", "/raices", {}, true);
  exigir(publicacion.estado === 201, "No se pudo publicar la raíz", publicacion.datos);
  const cadena = await pedir("GET", "/raices?desde=0&limite=500");
  const resultado = await verificarCadenaRaices(cadena.datos.raices, llavePublicaServidor);
  exigir(resultado.valida, "La cadena de raíces no es válida", resultado);
  const ultima = resultado.ultima.contenido;
  console.log(`Cadena de ${cadena.datos.raices.length} raíces verificada; última n.º ${ultima.numero}`);
  console.log(`Totales firmados: ${JSON.stringify(ultima.totales)}`);
  console.log("Todo el camino funciona.");
}

principal().catch((error) => {
  console.error(`Falló: ${error.message}`);
  process.exitCode = 1;
});
