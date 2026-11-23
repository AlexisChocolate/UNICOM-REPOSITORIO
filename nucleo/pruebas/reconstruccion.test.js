import { test } from "node:test";
import assert from "node:assert/strict";
import { siguienteRenglon } from "../cuaderno.js";
import { reconstruirEstado, totalesDelEstado } from "../reconstruccion.js";
import { firmarObjeto } from "../firmados.js";
import { firmarHuella, generarLlaveNoExportable, llavePublicaHex } from "../firmas.js";
import { huellaActa } from "../acta.js";
import { huellaHex } from "../huellas.js";
import { crearGenesis, crearRaiz, crearRotacion, llaveParaRenglon, verificarCadenaRaices } from "../raices.js";
import { vaciosPorNivel, NIVELES } from "../tablero.js";

async function llave() {
  const par = await generarLlaveNoExportable();
  return { privada: par.privateKey, publica: await llavePublicaHex(par.publicKey) };
}

class Cuaderno {
  constructor() {
    this.renglones = [];
  }

  async anotar(tipo, contenido) {
    const renglon = await siguienteRenglon(this.renglones.at(-1) ?? null, tipo, contenido);
    this.renglones.push(renglon);
    return renglon;
  }
}

async function paquete(mesa, sol, reemplazaA = null) {
  return {
    mesa,
    votos: { P01: sol, P02: 80, blancos: 6, nulos: 4, impugnados: 1 },
    foto_sha256: await huellaHex(new TextEncoder().encode(`foto ${mesa} ${sol}`)),
    precinto_sha256: null,
    precinto_numero: null,
    fecha_hora_declarada: "2026-11-27T16:05:00-05:00",
    personeros_presentes: false,
    reemplaza_a: reemplazaA,
  };
}

async function acta(paqueteDeMesa, firmante) {
  const huellaDelActa = await huellaActa(paqueteDeMesa);
  return {
    firmas: [{ rol: "miembro", llave_publica: firmante.publica, firma: await firmarHuella(firmante.privada, huellaDelActa) }],
    huella_acta: huellaDelActa,
    paquete: paqueteDeMesa,
  };
}

async function escenario() {
  const cuaderno = new Cuaderno();
  const onpe = await llave();
  const rosa = await llave();
  await cuaderno.anotar("autoridad", { nombre: "ONPE", llave_publica: onpe.publica });
  await cuaderno.anotar("padron", await firmarObjeto(onpe.privada, onpe.publica, { rol: "miembro", mesa: "045123", partido: null, llave_publica: rosa.publica }));
  return { cuaderno, onpe, rosa };
}

test("el estado se reconstruye solo desde el cuaderno y suma las actas vigentes", async () => {
  const { cuaderno, rosa } = await escenario();
  const primera = await paquete("045123", 120);
  await cuaderno.anotar("acta", await acta(primera, rosa));
  await cuaderno.anotar("acta", await acta(await paquete("045123", 121, await huellaActa(primera)), rosa));
  const estado = await reconstruirEstado(cuaderno.renglones);
  assert.deepEqual(estado.problemas, []);
  assert.equal(estado.actas.size, 1);
  assert.equal(totalesDelEstado(estado).P01, 121);
});

test("un padrón firmado por una llave que no es autoridad se señala", async () => {
  const { cuaderno } = await escenario();
  const impostor = await llave();
  const intruso = await llave();
  await cuaderno.anotar("padron", await firmarObjeto(impostor.privada, impostor.publica, { rol: "miembro", mesa: "045124", partido: null, llave_publica: intruso.publica }));
  const estado = await reconstruirEstado(cuaderno.renglones);
  assert.equal(estado.problemas.length, 1);
  assert.match(estado.problemas[0].motivo, /no es de una autoridad/);
});

test("Rosa pierde su llave: tras el reemplazo, la vieja ya no firma y las actas anteriores siguen válidas", async () => {
  const { cuaderno, onpe, rosa } = await escenario();
  const primera = await paquete("045123", 120);
  await cuaderno.anotar("acta", await acta(primera, rosa));
  const rosaNueva = await llave();
  await cuaderno.anotar(
    "reemplazo_llave",
    await firmarObjeto(onpe.privada, onpe.publica, { mesa: "045123", llave_vieja: rosa.publica, llave_nueva: rosaNueva.publica, motivo: "cambio de celular" }),
  );
  await cuaderno.anotar("acta", await acta(await paquete("045123", 119, await huellaActa(primera)), rosa));
  let estado = await reconstruirEstado(cuaderno.renglones);
  assert.equal(estado.problemas.length, 1);
  assert.match(estado.problemas[0].motivo, /reemplazada/);
  assert.equal(totalesDelEstado(estado).P01, 120);

  cuaderno.renglones.pop();
  await cuaderno.anotar("acta", await acta(await paquete("045123", 119, await huellaActa(primera)), rosaNueva));
  estado = await reconstruirEstado(cuaderno.renglones);
  assert.deepEqual(estado.problemas, []);
  assert.equal(totalesDelEstado(estado).P01, 119);
});

test("un partido solo puede registrar a sus propios personeros", async () => {
  const { cuaderno } = await escenario();
  const partidoSol = await llave();
  const personeroRio = await llave();
  await cuaderno.anotar("autoridad", { nombre: "P01", llave_publica: partidoSol.publica });
  await cuaderno.anotar("padron", await firmarObjeto(partidoSol.privada, partidoSol.publica, { rol: "personero", mesa: null, partido: "P02", llave_publica: personeroRio.publica }));
  const estado = await reconstruirEstado(cuaderno.renglones);
  assert.match(estado.problemas[0].motivo, /no puede registrar/);
});

test("el Partido Río objeta el acta 045123 con su firma", async () => {
  const { cuaderno, onpe, rosa } = await escenario();
  const personeroRio = await llave();
  await cuaderno.anotar("padron", await firmarObjeto(onpe.privada, onpe.publica, { rol: "personero", mesa: null, partido: "P02", llave_publica: personeroRio.publica }));
  const primera = await paquete("045123", 120);
  await cuaderno.anotar("acta", await acta(primera, rosa));
  await cuaderno.anotar(
    "opinion",
    await firmarObjeto(personeroRio.privada, personeroRio.publica, { tipo: "objecion", mesa: "045123", huella_acta: await huellaActa(primera), motivo: "la foto no se lee bien" }),
  );
  const estado = await reconstruirEstado(cuaderno.renglones);
  assert.deepEqual(estado.problemas, []);
  assert.equal(estado.opiniones[0].tipo, "objecion");
});

test("rotación de la llave del servidor: la cadena sigue válida y cambia la llave vigente", async () => {
  const vieja = await llave();
  const nueva = await llave();
  const vacios = await vaciosPorNivel(5);
  const genesis = await crearGenesis(vieja.privada, vieja.publica, "2026-11-23T08:00:00.000Z");
  const primera = await crearRaiz(vieja.privada, { anterior: genesis, raizTablero: vacios[NIVELES], ultimoRenglon: { numero: 4, huella: "ab".repeat(32) }, fecha: "2026-11-23T09:00:00.000Z" });
  const rotacion = await crearRotacion(vieja.privada, { anterior: primera, llaveNueva: nueva.publica, motivo: "prueba de rotacion", fecha: "2026-11-23T10:00:00.000Z" });
  const segunda = await crearRaiz(nueva.privada, { anterior: rotacion, raizTablero: vacios[NIVELES], ultimoRenglon: { numero: 6, huella: "cd".repeat(32) }, fecha: "2026-11-23T11:00:00.000Z" });
  const resultado = await verificarCadenaRaices([genesis, primera, rotacion, segunda], vieja.publica);
  assert.equal(resultado.valida, true);
  assert.equal(resultado.llaveVigente, nueva.publica);
  assert.equal(llaveParaRenglon([genesis, primera, rotacion, segunda], 3), vieja.publica);
  assert.equal(llaveParaRenglon([genesis, primera, rotacion, segunda], 5), nueva.publica);

  const segundaConLlaveVieja = await crearRaiz(vieja.privada, { anterior: rotacion, raizTablero: vacios[NIVELES], ultimoRenglon: { numero: 6, huella: "cd".repeat(32) }, fecha: "2026-11-23T11:00:00.000Z" });
  assert.equal((await verificarCadenaRaices([genesis, primera, rotacion, segundaConLlaveVieja], vieja.publica)).valida, false);
});
