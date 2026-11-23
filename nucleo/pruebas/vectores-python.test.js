import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATEGORIAS, construirTablero } from "../index.js";

const vectores = JSON.parse(readFileSync(new URL("../../merkle-py/vectores.json", import.meta.url), "utf8"));

test("los vectores compartidos con merkle-py siguen saliendo iguales en JavaScript", async () => {
  assert.deepEqual(vectores.categorias, CATEGORIAS);
  for (const vector of vectores.vectores) {
    const tablero = await construirTablero(
      vector.hojas.map((hoja) => ({ casillero: hoja.casillero, huellaActa: hoja.huella_acta, sumas: hoja.sumas })),
      CATEGORIAS.length,
    );
    assert.deepEqual(tablero.raiz, vector.raiz, vector.nombre);
  }
});
