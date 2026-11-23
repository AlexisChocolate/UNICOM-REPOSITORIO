import { test } from "node:test";
import assert from "node:assert/strict";
import { almacenLocal } from "../../almacen/local.js";
import { archivosEnMemoria } from "../../almacen/archivos.js";
import {
  firmarHuella,
  firmarObjeto,
  generarLlaveNoExportable,
  huellaActa,
  huellaHex,
  llavePublicaHex,
  reconstruirEstado,
  totalesDelEstado,
  verificarCadenaRaices,
  verificarCuaderno,
  verificarDocumento,
} from "../../nucleo/index.js";
import { Ventanilla, normalizarEntrada } from "../ventanilla.js";
import { subirFoto, bajarFoto } from "../fotos.js";

async function nuevaLlave() {
  const llaves = await generarLlaveNoExportable();
  return { privada: llaves.privateKey, publica: await llavePublicaHex(llaves.publicKey) };
}

const HORA = new Date("2026-11-27T21:30:00.000Z");

async function escenarioConAutoridades() {
  const almacen = almacenLocal();
  const archivos = archivosEnMemoria();
  const servidor = await nuevaLlave();
  const servidorNuevo = await nuevaLlave();
  const ventanilla = new Ventanilla({
    almacen,
    archivos,
    llaves: [
      { llavePrivada: servidor.privada, llavePublica: servidor.publica },
      { llavePrivada: servidorNuevo.privada, llavePublica: servidorNuevo.publica },
    ],
    reloj: () => HORA,
  });
  const onpe = await nuevaLlave();
  const partidoRio = await nuevaLlave();
  const rosa = await nuevaLlave();
  const personeroRio = await nuevaLlave();
  await ventanilla.registrarAutoridad({ nombre: "ONPE", llave_publica: onpe.publica });
  await ventanilla.registrarAutoridad({ nombre: "P02", llave_publica: partidoRio.publica });
  await ventanilla.registrarEnPadron(
    await firmarObjeto(onpe.privada, onpe.publica, normalizarEntrada({ rol: "miembro", mesa: "045123", llave_publica: rosa.publica })),
  );
  await ventanilla.registrarEnPadron(
    await firmarObjeto(partidoRio.privada, partidoRio.publica, normalizarEntrada({ rol: "personero", partido: "P02", llave_publica: personeroRio.publica })),
  );
  return { almacen, archivos, ventanilla, servidor, servidorNuevo, onpe, partidoRio, rosa, personeroRio };
}

async function paquete(cambios = {}) {
  return {
    mesa: "045123",
    votos: { P01: 120, P02: 80, blancos: 6, nulos: 4, impugnados: 1 },
    foto_sha256: await huellaHex(new TextEncoder().encode("foto del acta 045123")),
    precinto_sha256: null,
    precinto_numero: null,
    fecha_hora_declarada: "2026-11-27T16:05:00-05:00",
    personeros_presentes: false,
    reemplaza_a: null,
    ...cambios,
  };
}

async function firmada(paqueteDeMesa, llave) {
  const huellaDelActa = await huellaActa(paqueteDeMesa);
  return { paquete: paqueteDeMesa, firmas: [{ rol: "miembro", llave_publica: llave.publica, firma: await firmarHuella(llave.privada, huellaDelActa) }] };
}

test("el padrón firmado por la ONPE y por el Partido Río se acepta y queda verificable en el cuaderno", async () => {
  const { almacen, ventanilla, rosa } = await escenarioConAutoridades();
  const resultado = await ventanilla.recibirActa(await firmada(await paquete(), rosa));
  assert.equal(resultado.repetida, false);
  const renglones = await almacen.leerRenglones(1, 100);
  const estado = await reconstruirEstado(renglones);
  assert.deepEqual(estado.problemas, []);
  assert.equal(estado.padron.size, 2);
});

test("sin firma de autoridad ni clave de administración, el padrón no acepta la entrada", async () => {
  const { ventanilla } = await escenarioConAutoridades();
  const intruso = await nuevaLlave();
  await assert.rejects(ventanilla.registrarEnPadron({ rol: "miembro", mesa: "045124", llave_publica: intruso.publica }), (error) => error.codigo === "no_autorizado");
});

test("el Partido Río no puede registrar miembros de mesa", async () => {
  const { ventanilla, partidoRio } = await escenarioConAutoridades();
  const otro = await nuevaLlave();
  const firmado = await firmarObjeto(partidoRio.privada, partidoRio.publica, normalizarEntrada({ rol: "miembro", mesa: "045124", llave_publica: otro.publica }));
  await assert.rejects(ventanilla.registrarEnPadron(firmado), (error) => error.codigo === "autoridad_sin_permiso");
});

test("Rosa cambia de celular: la ONPE reemplaza su llave, la vieja ya no firma y la nueva sí", async () => {
  const { ventanilla, onpe, rosa } = await escenarioConAutoridades();
  const rosaNueva = await nuevaLlave();
  await ventanilla.reemplazarLlave(
    await firmarObjeto(onpe.privada, onpe.publica, { llave_nueva: rosaNueva.publica, llave_vieja: rosa.publica, mesa: "045123", motivo: "cambio de celular" }),
  );
  await assert.rejects(ventanilla.recibirActa(await firmada(await paquete(), rosa)), (error) => error.codigo === "firmante_no_registrado");
  const resultado = await ventanilla.recibirActa(await firmada(await paquete(), rosaNueva));
  assert.equal(resultado.repetida, false);
});

test("el Partido Río objeta el acta y la objeción queda firmada en el cuaderno", async () => {
  const { almacen, ventanilla, rosa, personeroRio } = await escenarioConAutoridades();
  const paqueteDeMesa = await paquete();
  await ventanilla.recibirActa(await firmada(paqueteDeMesa, rosa));
  const opinion = await ventanilla.registrarOpinion(
    await firmarObjeto(personeroRio.privada, personeroRio.publica, {
      huella_acta: await huellaActa(paqueteDeMesa),
      mesa: "045123",
      motivo: "el total de nulos no se lee en la foto",
      tipo: "objecion",
    }),
  );
  assert.equal(opinion.sobre_acta_vigente, true);
  assert.equal((await almacen.leerOpiniones("045123"))[0].tipo, "objecion");
});

test("la misma foto en dos mesas genera la alerta foto_repetida sin frenar el acta", async () => {
  const { ventanilla, onpe, rosa } = await escenarioConAutoridades();
  const miembroOtraMesa = await nuevaLlave();
  await ventanilla.registrarEnPadron(
    await firmarObjeto(onpe.privada, onpe.publica, normalizarEntrada({ rol: "miembro", mesa: "045124", llave_publica: miembroOtraMesa.publica })),
  );
  await ventanilla.recibirActa(await firmada(await paquete(), rosa));
  const segunda = await ventanilla.recibirActa(await firmada(await paquete({ mesa: "045124" }), miembroOtraMesa));
  assert.equal(segunda.repetida, false);
  assert.deepEqual(segunda.alertas.find((alerta) => alerta.codigo === "foto_repetida").mesas, ["045123"]);
});

test("la foto sube por su huella y se baja igual; si no se subió, el acta avisa foto_no_subida", async () => {
  const { almacen, archivos, ventanilla, rosa } = await escenarioConAutoridades();
  const bytes = new TextEncoder().encode("foto del acta 045123");
  const huella = await huellaHex(bytes);
  const sinFoto = await ventanilla.recibirActa(await firmada(await paquete(), rosa));
  assert.ok(sinFoto.alertas.some((alerta) => alerta.codigo === "foto_no_subida"));
  const subida = await subirFoto({ bytes, tipo: "image/jpeg", llavePublica: rosa.publica, firma: await firmarHuella(rosa.privada, huella), almacen, archivos, ahora: HORA });
  assert.equal(subida.huella, huella);
  const bajada = await bajarFoto({ huella, almacen, archivos });
  assert.equal(await huellaHex(bajada.bytes), huella);
});

test("una foto con firma de alguien fuera del padrón se rechaza", async () => {
  const { almacen, archivos } = await escenarioConAutoridades();
  const intruso = await nuevaLlave();
  const bytes = new TextEncoder().encode("basura");
  await assert.rejects(
    subirFoto({ bytes, tipo: "image/png", llavePublica: intruso.publica, firma: await firmarHuella(intruso.privada, await huellaHex(bytes)), almacen, archivos, ahora: HORA }),
    (error) => error.codigo === "firmante_no_registrado",
  );
});

test("la raíz automática solo se publica si el cuaderno creció, y deja un volcado para los auditores", async () => {
  const { archivos, ventanilla, rosa } = await escenarioConAutoridades();
  const primera = await ventanilla.publicarRaiz({ soloSiCambio: true });
  assert.equal(primera.publicadas.length, 2);
  const sinCambio = await ventanilla.publicarRaiz({ soloSiCambio: true });
  assert.equal(sinCambio.publicadas.length, 0);
  await ventanilla.recibirActa(await firmada(await paquete(), rosa));
  const segunda = await ventanilla.publicarRaiz({ soloSiCambio: true });
  assert.equal(segunda.publicadas.length, 1);
  const volcado = JSON.parse(new TextDecoder().decode((await archivos.leer("volcados/raiz-000002.json")).bytes));
  assert.equal(volcado.renglones.length, 1);
  assert.equal(volcado.renglones[0].tipo, "acta");
});

test("rotación de la llave del servidor: los recibos nuevos se firman con la llave nueva y la cadena sigue válida", async () => {
  const { almacen, ventanilla, servidor, servidorNuevo, rosa } = await escenarioConAutoridades();
  await ventanilla.publicarRaiz();
  await ventanilla.rotarLlave({ llavePublicaNueva: servidorNuevo.publica, motivo: "prueba de rotacion" });
  const resultado = await ventanilla.recibirActa(await firmada(await paquete(), rosa));
  assert.equal(await verificarDocumento(resultado.recibo, servidorNuevo.publica), true);
  assert.equal(await verificarDocumento(resultado.recibo, servidor.publica), false);
  await ventanilla.publicarRaiz();
  const cadena = await verificarCadenaRaices(await almacen.leerRaices(0, 100), servidor.publica);
  assert.equal(cadena.valida, true);
  assert.equal(cadena.llaveVigente, servidorNuevo.publica);
});

test("todo lo anotado reconstruye el mismo total y un cuaderno sin ramas", async () => {
  const { almacen, ventanilla, rosa } = await escenarioConAutoridades();
  await ventanilla.recibirActa(await firmada(await paquete(), rosa));
  const renglones = await almacen.leerRenglones(1, 100);
  assert.equal((await verificarCuaderno(renglones)).valido, true);
  assert.equal(totalesDelEstado(await reconstruirEstado(renglones)).P01, 120);
});
