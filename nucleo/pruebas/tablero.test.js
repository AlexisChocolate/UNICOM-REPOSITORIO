import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesAHex, concatenar } from "../bytes.js";
import { huella, huellaHex } from "../huellas.js";
import {
  NIVELES,
  actualizarCasillero,
  construirTablero,
  hojaLlena,
  posicionesHermanas,
  vaciosPorNivel,
  verificarInclusion,
} from "../tablero.js";

const CATEGORIAS_PRUEBA = 3;

async function huellaDeEjemplo(texto) {
  return huellaHex(new TextEncoder().encode(texto));
}

async function actasDeJuliaca() {
  return [
    { casillero: 45123, huellaActa: await huellaDeEjemplo("acta 045123"), sumas: [120, 80, 5] },
    { casillero: 45124, huellaActa: await huellaDeEjemplo("acta 045124"), sumas: [98, 110, 3] },
    { casillero: 100, huellaActa: await huellaDeEjemplo("acta 000100"), sumas: [40, 60, 0] },
    { casillero: 131071, huellaActa: await huellaDeEjemplo("acta 131071"), sumas: [7, 9, 1] },
  ];
}

class TableroIncremental {
  constructor() {
    this.nodos = new Map();
  }

  hermanos(casillero) {
    return posicionesHermanas(casillero).map(({ nivel, indice }) => this.nodos.get(`${nivel}:${indice}`) ?? null);
  }

  async poner(casillero, huellaActa, sumas) {
    const hoja = await hojaLlena(casillero, huellaActa, sumas);
    const resultado = await actualizarCasillero({ casillero, hoja, hermanos: this.hermanos(casillero) });
    for (const nodo of resultado.nodos) {
      this.nodos.set(`${nodo.nivel}:${nodo.indice}`, { huella: nodo.huella, sumas: nodo.sumas });
    }
    return resultado.raiz;
  }
}

test("los vacíos por nivel siguen la regla del plan: nivel 0 = SHA-256(0x02)", async () => {
  const vacios = await vaciosPorNivel(CATEGORIAS_PRUEBA);
  assert.equal(vacios.length, NIVELES + 1);
  assert.equal(vacios[0].huella, bytesAHex(await huella(Uint8Array.of(0x02))));
  const ceros = new Uint8Array(8 * CATEGORIAS_PRUEBA);
  const esperado = await huella(
    concatenar(Uint8Array.of(0x01), await huella(Uint8Array.of(0x02)), await huella(Uint8Array.of(0x02)), ceros, ceros),
  );
  assert.equal(vacios[1].huella, bytesAHex(esperado));
  assert.deepEqual(vacios[NIVELES].sumas, [0, 0, 0]);
});

test("un tablero sin actas tiene como raíz el vacío del nivel 17", async () => {
  const vacios = await vaciosPorNivel(CATEGORIAS_PRUEBA);
  const tablero = await construirTablero([], CATEGORIAS_PRUEBA);
  assert.deepEqual(tablero.raiz, vacios[NIVELES]);
});

test("la raíz suma los votos de todas las mesas", async () => {
  const tablero = await construirTablero(await actasDeJuliaca(), CATEGORIAS_PRUEBA);
  assert.deepEqual(tablero.raiz.sumas, [265, 259, 9]);
});

test("actualizar por partes da la misma raíz que construir el tablero completo", async () => {
  const actas = await actasDeJuliaca();
  const incremental = new TableroIncremental();
  let raiz;
  for (const acta of actas) {
    raiz = await incremental.poner(acta.casillero, acta.huellaActa, acta.sumas);
  }
  const completo = await construirTablero(actas, CATEGORIAS_PRUEBA);
  assert.deepEqual(raiz, completo.raiz);
});

test("el orden de llegada de las actas no cambia la raíz", async () => {
  const actas = await actasDeJuliaca();
  const enOrden = new TableroIncremental();
  const alReves = new TableroIncremental();
  let raizEnOrden;
  let raizAlReves;
  for (const acta of actas) {
    raizEnOrden = await enOrden.poner(acta.casillero, acta.huellaActa, acta.sumas);
  }
  for (const acta of [...actas].reverse()) {
    raizAlReves = await alReves.poner(acta.casillero, acta.huellaActa, acta.sumas);
  }
  assert.deepEqual(raizEnOrden, raizAlReves);
});

test("solo se guardan nodos con al menos un acta: 18 por cada acta aislada", async () => {
  const incremental = new TableroIncremental();
  await incremental.poner(45123, await huellaDeEjemplo("acta 045123"), [120, 80, 5]);
  assert.equal(incremental.nodos.size, NIVELES + 1);
});

test("la prueba de inclusión de la mesa 045123 llega a la raíz con sus sumas", async () => {
  const actas = await actasDeJuliaca();
  const incremental = new TableroIncremental();
  let raiz;
  for (const acta of actas) {
    raiz = await incremental.poner(acta.casillero, acta.huellaActa, acta.sumas);
  }
  const vacios = await vaciosPorNivel(CATEGORIAS_PRUEBA);
  const hermanos = incremental.hermanos(45123).map((hermano, nivel) => hermano ?? vacios[nivel]);
  const rosa = actas[0];
  assert.equal(await verificarInclusion({ ...rosa, hermanos, raiz }), true);
  assert.equal(await verificarInclusion({ ...rosa, sumas: [150, 80, 5], hermanos, raiz }), false);
  assert.equal(await verificarInclusion({ ...rosa, casillero: 45122, hermanos, raiz }), false);
  assert.equal(await verificarInclusion({ ...rosa, hermanos: hermanos.slice(1), raiz }), false);
});

test("un hermano que declara sumas falsas no puede cuadrar con la raíz", async () => {
  const actas = await actasDeJuliaca();
  const tablero = await construirTablero(actas, CATEGORIAS_PRUEBA);
  const vacios = await vaciosPorNivel(CATEGORIAS_PRUEBA);
  const hermanos = posicionesHermanas(45123).map(({ nivel, indice }) => tablero.nodo(nivel, indice) ?? vacios[nivel]);
  const alterados = hermanos.map((hermano) => ({ ...hermano, sumas: [...hermano.sumas] }));
  alterados[0].sumas[0] += 30;
  assert.equal(await verificarInclusion({ ...actas[0], hermanos, raiz: tablero.raiz }), true);
  assert.equal(await verificarInclusion({ ...actas[0], hermanos: alterados, raiz: tablero.raiz }), false);
});

test("la hoja lleva el casillero: la misma acta en otro casillero da otra huella", async () => {
  const huellaActa = await huellaDeEjemplo("acta 045123");
  const enSuCasillero = await hojaLlena(45123, huellaActa, [120, 80, 5]);
  const enOtroCasillero = await hojaLlena(45124, huellaActa, [120, 80, 5]);
  assert.notEqual(enSuCasillero.huella, enOtroCasillero.huella);
});

test("el tablero rechaza votos negativos, decimales y casilleros fuera de rango", async () => {
  const huellaActa = await huellaDeEjemplo("acta 045123");
  await assert.rejects(hojaLlena(45123, huellaActa, [-1, 80, 5]), /mayores o iguales a 0/);
  await assert.rejects(hojaLlena(45123, huellaActa, [1.5, 80, 5]), /mayores o iguales a 0/);
  await assert.rejects(hojaLlena(2 ** 17, huellaActa, [1, 80, 5]), /fuera del tablero/);
});
