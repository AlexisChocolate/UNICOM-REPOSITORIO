import { test } from "node:test";
import assert from "node:assert/strict";
import { canonico } from "../json-canonico.js";
import { huellaHex, huellaDeObjeto } from "../huellas.js";
import { textoABytes } from "../bytes.js";

test("SHA-256 de \"abc\" coincide con el ejemplo de NIST FIPS 180-4", async () => {
  assert.equal(await huellaHex(textoABytes("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("JSON canónico ordena las claves y no deja espacios", () => {
  assert.equal(canonico({ mesa: "045123", votos: { P02: 80, P01: 120 } }), '{"mesa":"045123","votos":{"P01":120,"P02":80}}');
});

test("JSON canónico da la misma huella sin importar el orden en que se escribieron las claves", async () => {
  const primero = await huellaDeObjeto({ mesa: "045123", distrito: "Juliaca" });
  const segundo = await huellaDeObjeto({ distrito: "Juliaca", mesa: "045123" });
  assert.equal(primero, segundo);
});

test("JSON canónico rechaza tildes, decimales y valores indefinidos", () => {
  assert.throws(() => canonico({ partido: "Partido Río" }), /ASCII/);
  assert.throws(() => canonico({ votos: 120.5 }), /enteros/);
  assert.throws(() => canonico({ votos: undefined }), /no tiene valor/);
  assert.throws(() => canonico({ votos: 2 ** 60 }), /enteros/);
});

test("JSON canónico acepta listas, booleanos y null", () => {
  assert.equal(canonico([true, false, null, -3, "P01"]), '[true,false,null,-3,"P01"]');
});
