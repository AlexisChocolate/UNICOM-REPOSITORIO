// Recorre el camino completo contra un Worker ya levantado (local o desplegado):
// padrón -> foto -> lector de IA -> acta firmada -> recibo -> respaldo -> prueba de inclusión -> raíz -> volcado.
//
//   $env:CLAVE_ADMIN = "..."          (PowerShell; la misma clave guardada como secreto del Worker)
//   node api/prueba-de-punta-a-punta.js https://unicom-api.myk-unicom.workers.dev [mesa]
import {
  contenidoPeticionLectura,
  firmarHuella,
  firmarObjeto,
  generarLlaveNoExportable,
  huellaActa,
  huellaDeObjeto,
  huellaHex,
  llavePublicaHex,
  verificarCadenaRaices,
  verificarDocumento,
  verificarInclusion,
} from "../nucleo/index.js";

const direccion = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const mesa = process.argv[3] ?? "045123";
const claveAdmin = process.env.CLAVE_ADMIN;

async function pedir(metodo, ruta, cuerpo, { conAdmin = false, encabezados = {}, crudo = false } = {}) {
  const todos = { ...encabezados };
  if (!crudo) {
    todos["content-type"] = "application/json";
  }
  if (conAdmin) {
    todos.authorization = `Bearer ${claveAdmin}`;
  }
  const respuesta = await fetch(direccion + ruta, {
    method: metodo,
    headers: todos,
    body: cuerpo === undefined ? undefined : crudo ? cuerpo : JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, datos: await respuesta.json() };
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
  console.log(`Llave pública vigente del servidor: ${llavePublicaServidor}`);

  const llavesRosa = await generarLlaveNoExportable();
  const llavePublicaRosa = await llavePublicaHex(llavesRosa.publicKey);
  const registro = await pedir("POST", "/padron", { rol: "miembro", mesa, llave_publica: llavePublicaRosa }, { conAdmin: true });
  exigir(registro.estado === 201, "No se pudo registrar a Rosa en el padrón", registro.datos);
  console.log(`Rosa quedó en el padrón de la mesa ${mesa} (renglón ${registro.datos.renglon}, carga provisional del administrador)`);

  const foto = new TextEncoder().encode(`foto del acta ${mesa}, Juliaca, ${new Date().toISOString()}`);
  const huellaFoto = await huellaHex(foto);
  const subida = await pedir("POST", "/fotos", foto, {
    crudo: true,
    encabezados: { "content-type": "image/jpeg", "x-unicom-llave": llavePublicaRosa, "x-unicom-firma": await firmarHuella(llavesRosa.privateKey, huellaFoto) },
  });
  exigir([200, 201].includes(subida.estado) && subida.datos.huella === huellaFoto, "No se pudo subir la foto", subida.datos);
  const bajada = new Uint8Array(await (await fetch(`${direccion}/fotos/${huellaFoto}`)).arrayBuffer());
  exigir((await huellaHex(bajada)) === huellaFoto, "La foto bajada no tiene su huella", {});
  console.log(`Foto subida y bajada por su huella ${huellaFoto.slice(0, 16)}...`);

  const peticionLector = {
    mesa,
    momento: "antes_del_sello",
    fecha: new Date().toISOString(),
    huella_foto: huellaFoto,
    huella_imagen_enviada: huellaFoto,
    tipo_imagen: "image/jpeg",
    imagen_base64: Buffer.from(foto).toString("base64"),
    llave_publica: llavePublicaRosa,
  };
  peticionLector.firma = await firmarHuella(llavesRosa.privateKey, await huellaDeObjeto(contenidoPeticionLectura(peticionLector)));
  const lectura = await pedir("POST", "/lector", peticionLector);
  exigir(lectura.estado === 200, "El lector no respondió como se esperaba", lectura.datos);
  console.log(`Lector de IA: ${lectura.datos.estado}${lectura.datos.motivo ? ` (${lectura.datos.motivo})` : ""}, anotado en el renglón ${lectura.datos.renglon}`);

  const anterior = await pedir("GET", `/actas/${mesa}`);
  const reemplazaA = anterior.estado === 200 ? anterior.datos.huella_acta : null;
  const paquete = {
    mesa,
    votos: { P01: 120, P02: 80 + Math.floor(Math.random() * 20), blancos: 6, nulos: 4, impugnados: 1 },
    foto_sha256: huellaFoto,
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
  exigir(!envio.datos.alertas.some((alerta) => alerta.codigo === "foto_no_subida"), "El servidor no encontró la foto subida", envio.datos.alertas);
  console.log(`Acta ${mesa} anotada en el renglón ${recibo.contenido.renglon}; recibo firmado y verificado`);
  if (reemplazaA) {
    console.log(`(corrige al acta anterior ${reemplazaA.slice(0, 16)}...)`);
  }

  const respaldo = await pedir(
    "POST",
    "/opiniones",
    await firmarObjeto(llavesRosa.privateKey, llavePublicaRosa, { huella_acta: huellaDelActa, mesa, motivo: "la mesa confirma su acta", tipo: "respaldo" }),
  );
  exigir(respaldo.estado === 201, "No se pudo anotar el respaldo", respaldo.datos);

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
  console.log(`Prueba de inclusión verificada hasta la raíz ${prueba.datos.raiz.huella.slice(0, 16)}... (${prueba.datos.opiniones.length} opinión(es) sobre la mesa)`);

  const publicacion = await pedir("POST", "/raices", {}, { conAdmin: true });
  exigir(publicacion.estado === 201, "No se pudo publicar la raíz", publicacion.datos);
  const cadena = await pedir("GET", "/raices?desde=0&limite=500");
  const resultado = await verificarCadenaRaices(cadena.datos.raices);
  exigir(resultado.valida, "La cadena de raíces no es válida", resultado);
  const ultima = resultado.ultima.contenido;
  console.log(`Cadena de ${cadena.datos.raices.length} raíces verificada; última n.º ${ultima.numero}`);
  console.log(`Totales firmados: ${JSON.stringify(ultima.totales)}`);
  const volcado = await fetch(`${direccion}/volcados/raiz-${String(ultima.numero).padStart(6, "0")}.json`);
  exigir(volcado.ok, "No se encontró el volcado de la raíz para los auditores", {});
  console.log(`Volcado para auditores: ${(await volcado.json()).renglones.length} renglones nuevos`);
  console.log("Todo el camino funciona.");
}

principal().catch((error) => {
  console.error(`Falló: ${error.message}`);
  process.exitCode = 1;
});
