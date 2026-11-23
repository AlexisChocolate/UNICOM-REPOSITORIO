import { test } from "node:test";
import assert from "node:assert/strict";
import { construirTablero } from "../tablero.js";
import { compararTableros, examinarActa } from "../detective.js";
import { CATEGORIAS, huellaActa, sumasDeVotos } from "../acta.js";
import { firmarHuella, generarLlaveNoExportable, llavePublicaHex } from "../firmas.js";
import { huellaHex } from "../huellas.js";

async function actaFirmada(mesa, votos, llaves) {
  const paquete = {
    mesa,
    votos,
    foto_sha256: await huellaHex(new TextEncoder().encode(`foto ${mesa}`)),
    precinto_sha256: null,
    precinto_numero: null,
    fecha_hora_declarada: "2026-11-27T16:05:00-05:00",
    personeros_presentes: false,
    reemplaza_a: null,
  };
  const huellaDelActa = await huellaActa(paquete);
  const firmas = [{ rol: "miembro", llave_publica: await llavePublicaHex(llaves.publicKey), firma: await firmarHuella(llaves.privateKey, huellaDelActa) }];
  return { paquete, firmas, huellaDelActa };
}

async function escenarioDeJuliaca() {
  const llavesRosa = await generarLlaveNoExportable();
  const actas = [];
  for (const [mesa, sol] of [["045120", 98], ["045123", 120], ["045124", 77], ["100500", 51]]) {
    actas.push(await actaFirmada(mesa, { P01: sol, P02: 80, blancos: 6, nulos: 4, impugnados: 1 }, llavesRosa));
  }
  return actas;
}

function hojas(actas) {
  return actas.map((acta) => ({ casillero: Number(acta.paquete.mesa), huellaActa: acta.huellaDelActa, sumas: sumasDeVotos(acta.paquete.votos) }));
}

test("el detective baja hasta la mesa 045123 cuando alguien cambia Sol 120 por 150", async () => {
  const actas = await escenarioDeJuliaca();
  const anclado = await construirTablero(hojas(actas), CATEGORIAS.length);
  const alterada = structuredClone(actas[1]);
  alterada.paquete.votos.P01 = 150;
  alterada.huellaDelActa = await huellaActa(alterada.paquete);
  const actual = await construirTablero(hojas([actas[0], alterada, actas[2], actas[3]]), CATEGORIAS.length);

  const { alterados, comparaciones } = compararTableros(anclado, actual);
  assert.deepEqual(alterados, [45123]);
  assert.ok(comparaciones <= 2 * 17 + 1, `hizo ${comparaciones} comparaciones`);

  const examen = await examinarActa({ ancladaHoja: hojas(actas)[1], actaServidor: alterada });
  assert.equal(examen.veredicto, "firma_rota");
  assert.equal(examen.votos_servidor.P01, 150);
  assert.equal(examen.foto_sha256, actas[1].paquete.foto_sha256);
});

test("tableros iguales: una sola comparación, nada alterado", async () => {
  const actas = await escenarioDeJuliaca();
  const primero = await construirTablero(hojas(actas), CATEGORIAS.length);
  const segundo = await construirTablero(hojas(actas), CATEGORIAS.length);
  assert.deepEqual(compararTableros(primero, segundo), { alterados: [], comparaciones: 1 });
});

test("un acta borrada del servidor también se encuentra", async () => {
  const actas = await escenarioDeJuliaca();
  const anclado = await construirTablero(hojas(actas), CATEGORIAS.length);
  const actual = await construirTablero(hojas([actas[0], actas[2], actas[3]]), CATEGORIAS.length);
  assert.deepEqual(compararTableros(anclado, actual).alterados, [45123]);
  assert.equal((await examinarActa({ ancladaHoja: hojas(actas)[1], actaServidor: null })).veredicto, "borrada");
});
