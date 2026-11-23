import { test } from "node:test";
import assert from "node:assert/strict";
import { HUELLA_INICIAL, siguienteRenglon, verificarCuaderno } from "../cuaderno.js";
import { crearGenesis, crearRaiz, verificarCadenaRaices } from "../raices.js";
import { generarLlaveNoExportable, llavePublicaHex } from "../firmas.js";
import { vaciosPorNivel, NIVELES } from "../tablero.js";
import { CATEGORIAS } from "../acta.js";

async function cuadernoDeJuliaca() {
  const primero = await siguienteRenglon(null, "padron", { rol: "miembro", mesa: "045123" });
  const segundo = await siguienteRenglon(primero, "acta", { mesa: "045123", huella_acta: "ab".repeat(32) });
  const tercero = await siguienteRenglon(segundo, "acta", { mesa: "045124", huella_acta: "cd".repeat(32) });
  return [primero, segundo, tercero];
}

test("el cuaderno empieza en el renglón 1 con la huella inicial", async () => {
  const [primero] = await cuadernoDeJuliaca();
  assert.equal(primero.numero, 1);
  assert.equal(primero.huella_anterior, HUELLA_INICIAL);
});

test("un cuaderno intacto se verifica", async () => {
  const resultado = await verificarCuaderno(await cuadernoDeJuliaca());
  assert.equal(resultado.valido, true);
  assert.equal(resultado.ultimo.numero, 3);
});

test("cambiar el contenido de un renglón se nota", async () => {
  const renglones = await cuadernoDeJuliaca();
  renglones[1] = { ...renglones[1], contenido: { mesa: "045123", huella_acta: "ef".repeat(32) } };
  const resultado = await verificarCuaderno(renglones);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.renglon, 2);
});

test("borrar un renglón se nota", async () => {
  const renglones = await cuadernoDeJuliaca();
  const resultado = await verificarCuaderno([renglones[0], renglones[2]]);
  assert.equal(resultado.valido, false);
  assert.equal(resultado.renglon, 3);
});

test("el auditor puede seguir verificando desde el último renglón que ya revisó", async () => {
  const renglones = await cuadernoDeJuliaca();
  const resultado = await verificarCuaderno(renglones.slice(2), renglones[1]);
  assert.equal(resultado.valido, true);
});

async function cadenaDeRaices() {
  const llaves = await generarLlaveNoExportable();
  const llavePublica = await llavePublicaHex(llaves.publicKey);
  const vacios = await vaciosPorNivel(CATEGORIAS.length);
  const genesis = await crearGenesis(llaves.privateKey, llavePublica, "2026-11-23T08:00:00.000Z");
  const renglones = await cuadernoDeJuliaca();
  const primera = await crearRaiz(llaves.privateKey, {
    anterior: genesis,
    raizTablero: vacios[NIVELES],
    ultimoRenglon: renglones[1],
    fecha: "2026-11-23T09:00:00.000Z",
  });
  const segunda = await crearRaiz(llaves.privateKey, {
    anterior: primera,
    raizTablero: { huella: "12".repeat(32), sumas: [120, 80, 3, 2, 0] },
    ultimoRenglon: renglones[2],
    fecha: "2026-11-23T10:00:00.000Z",
  });
  return { llavePublica, cadena: [genesis, primera, segunda] };
}

test("una cadena de raíces sin saltos y bien firmada se verifica", async () => {
  const { llavePublica, cadena } = await cadenaDeRaices();
  const resultado = await verificarCadenaRaices(cadena, llavePublica);
  assert.equal(resultado.valida, true);
  assert.equal(resultado.ultima.contenido.numero, 2);
  assert.deepEqual(resultado.ultima.contenido.totales, { P01: 120, P02: 80, blancos: 3, nulos: 2, impugnados: 0 });
});

test("quitar una raíz del medio rompe la cadena", async () => {
  const { llavePublica, cadena } = await cadenaDeRaices();
  const resultado = await verificarCadenaRaices([cadena[0], cadena[2]], llavePublica);
  assert.equal(resultado.valida, false);
  assert.match(resultado.motivo, /salto/);
});

test("una raíz cambiada después de firmarla no se verifica", async () => {
  const { llavePublica, cadena } = await cadenaDeRaices();
  const alterada = { ...cadena[2], contenido: { ...cadena[2].contenido, totales: { ...cadena[2].contenido.totales, P01: 150 } } };
  const resultado = await verificarCadenaRaices([cadena[0], cadena[1], alterada], llavePublica);
  assert.equal(resultado.valida, false);
});

test("una génesis con otra llave no se acepta", async () => {
  const { cadena } = await cadenaDeRaices();
  const resultado = await verificarCadenaRaices(cadena, "00".repeat(32));
  assert.equal(resultado.valida, false);
});
