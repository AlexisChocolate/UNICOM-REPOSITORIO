import { test } from "node:test";
import assert from "node:assert/strict";
import { contrastar, revisarSumas } from "../revision.js";

const votosJuliaca = { P01: 120, P02: 80, blancos: 6, nulos: 4, impugnados: 1 };

test("un acta que cuadra no tiene avisos", () => {
  assert.deepEqual(revisarSumas({ votos: votosJuliaca, electoresHabiles: 300, ciudadanosVotaron: 211, cedulasActaSufragio: 211 }), []);
});

test("si la suma no da el total de votantes, avisa", () => {
  const avisos = revisarSumas({ votos: votosJuliaca, electoresHabiles: 300, ciudadanosVotaron: 215 });
  assert.deepEqual(avisos.map((aviso) => aviso.codigo), ["suma_no_cuadra"]);
});

test("una casilla vacía se avisa antes que las sumas", () => {
  const avisos = revisarSumas({ votos: { ...votosJuliaca, nulos: "" }, electoresHabiles: 300, ciudadanosVotaron: 211 });
  assert.deepEqual(avisos.map((aviso) => aviso.codigo), ["casilla_vacia"]);
});

test("más votantes que electores hábiles se avisa", () => {
  const avisos = revisarSumas({ votos: { ...votosJuliaca, P01: 300 }, electoresHabiles: 250, ciudadanosVotaron: 391 });
  assert.ok(avisos.some((aviso) => aviso.codigo === "votantes_mayor_que_habiles"));
  assert.ok(avisos.some((aviso) => aviso.codigo === "supera_habiles" && aviso.campo === "P01"));
});

test("cédulas distintas de los votantes del acta de sufragio (art. 279) se avisa", () => {
  const avisos = revisarSumas({ votos: votosJuliaca, electoresHabiles: 300, ciudadanosVotaron: 211, cedulasActaSufragio: 209 });
  assert.deepEqual(avisos.map((aviso) => aviso.codigo), ["cedulas_no_coinciden"]);
});

const lecturaCoincide = {
  P01: { valor: 120, confianza: 0.97, tachon: false },
  P02: { valor: 80, confianza: 0.95, tachon: false },
  blancos: { valor: 6, confianza: 0.9, tachon: false },
  nulos: { valor: 4, confianza: 0.91, tachon: false },
  impugnados: { valor: 1, confianza: 0.93, tachon: false },
};

test("si la IA lee lo mismo con buena confianza, todo verde", () => {
  assert.equal(contrastar(lecturaCoincide, votosJuliaca).estado, "verde");
});

test("la IA leyó 5 y Rosa digitó 4: rojo en ese campo", () => {
  const lectura = { ...lecturaCoincide, nulos: { valor: 5, confianza: 0.9, tachon: false } };
  const resultado = contrastar(lectura, votosJuliaca);
  assert.equal(resultado.estado, "rojo");
  assert.equal(resultado.campos.nulos.valor_ia, 5);
  assert.equal(resultado.campos.nulos.valor_digitado, 4);
});

test("tachón o poca confianza: amarillo", () => {
  const conTachon = contrastar({ ...lecturaCoincide, P02: { valor: 80, confianza: 0.99, tachon: true } }, votosJuliaca);
  assert.equal(conTachon.campos.P02.motivo, "tachon");
  const dudosa = contrastar({ ...lecturaCoincide, P01: { valor: 120, confianza: 0.6, tachon: false } }, votosJuliaca);
  assert.equal(dudosa.estado, "amarillo");
});

test("sin respuesta de la IA: lectura pendiente, sin bloquear nada", () => {
  assert.equal(contrastar(null, votosJuliaca).estado, "lectura_pendiente");
});
