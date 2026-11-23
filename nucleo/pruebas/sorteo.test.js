import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  muestraRivest,
  rondaDrandEnFecha,
  semillaSorteo,
  sortearCedulas,
  sortearMesas,
  verificarEncabezadoBitcoin,
  verificarRondaDrand,
} from "../sorteo.js";

const casosRivest = JSON.parse(readFileSync(new URL("./datos/rivest-sampler-tests.json", import.meta.url), "utf8"));
const datosPublicos = JSON.parse(readFileSync(new URL("./datos/datos-publicos.json", import.meta.url), "utf8"));

for (const caso of casosRivest.tests) {
  test(`muestreo de Rivest coincide con el caso público de la semilla ${JSON.stringify(caso.data.seed)}`, async () => {
    const obtenido = await muestraRivest({
      semilla: caso.data.seed,
      hasta: caso.data.total,
      cantidad: caso.data.count,
      conReemplazo: true,
    });
    assert.deepEqual(obtenido, caso.expected);
  });
}

test("sin reemplazo no repite mesas", async () => {
  const elegidos = await muestraRivest({ semilla: "0", hasta: 2, cantidad: 2 });
  assert.deepEqual([...elegidos].sort(), [1, 2]);
});

test("la firma real de la ronda 1000 de drand quicknet se verifica", async () => {
  assert.equal(await verificarRondaDrand(datosPublicos.drand_quicknet_1000), true);
});

test("una firma de drand presentada como de otra ronda se rechaza", async () => {
  assert.equal(await verificarRondaDrand({ ...datosPublicos.drand_quicknet_1000, round: 1001 }), false);
});

test("una aleatoriedad de drand que no sale de la firma se rechaza", async () => {
  assert.equal(await verificarRondaDrand({ ...datosPublicos.drand_quicknet_1000, randomness: "00".repeat(32) }), false);
});

test("la ronda de drand se calcula desde la fecha", () => {
  assert.equal(rondaDrandEnFecha(new Date((1692803367 + 3 * 999) * 1000)), 1000);
});

test("el encabezado real del bloque 870000 corresponde a su hash", async () => {
  const bloque = datosPublicos.bloque_870000;
  assert.equal(await verificarEncabezadoBitcoin(bloque.encabezado, bloque.hash), true);
});

test("el encabezado del bloque génesis de Bitcoin corresponde a su hash", async () => {
  const bloque = datosPublicos.bloque_genesis;
  assert.equal(await verificarEncabezadoBitcoin(bloque.encabezado, bloque.hash), true);
  assert.equal(await verificarEncabezadoBitcoin(bloque.encabezado, datosPublicos.bloque_870000.hash), false);
});

test("semilla del sorteo: dados + drand + bloque, y cambia si cambia cualquiera", async () => {
  const datos = {
    dados: "3141526535",
    firmaDrand: datosPublicos.drand_quicknet_1000.signature,
    hashBloque: datosPublicos.bloque_870000.hash,
  };
  const semilla = await semillaSorteo(datos);
  assert.match(semilla, /^[0-9a-f]{64}$/);
  assert.notEqual(await semillaSorteo({ ...datos, dados: "3141526536" }), semilla);
  await assert.rejects(semillaSorteo({ ...datos, dados: "12" }), /al menos 10/);
});

test("el sorteo de mesas es reproducible y no depende del orden en que se entregan", async () => {
  const mesas = ["045123", "045124", "045125", "045126", "045127", "045128"];
  const primero = await sortearMesas({ semilla: "a1", mesas, cantidad: 3 });
  const segundo = await sortearMesas({ semilla: "a1", mesas: [...mesas].reverse(), cantidad: 3 });
  assert.deepEqual(primero, segundo);
  assert.equal(new Set(primero).size, 3);
});

test("las cédulas sorteadas están dentro del sobre y no se repiten", async () => {
  const cedulas = await sortearCedulas({ semilla: "a1", mesa: "045123", totalCedulas: 211, cantidad: 5 });
  assert.equal(cedulas.length, 5);
  assert.ok(cedulas.every((cedula) => cedula >= 1 && cedula <= 211));
  assert.equal(new Set(cedulas).size, 5);
});
