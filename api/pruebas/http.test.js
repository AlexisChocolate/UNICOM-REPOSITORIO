import { test } from "node:test";
import assert from "node:assert/strict";
import { encabezadosCors } from "../http.js";

const ORIGENES = "https://alexischocolate.github.io,http://localhost:8000";

function peticionDesde(origen) {
  return new Request("https://unicom-api.unicom-puno.workers.dev/fotos", { method: "OPTIONS", headers: { origin: origen } });
}

test("CORS deja a la app de mesa mandar la llave y la firma de la foto en sus encabezados", () => {
  const cors = encabezadosCors(peticionDesde("https://alexischocolate.github.io"), ORIGENES);
  const permitidos = cors["access-control-allow-headers"].split(",").map((nombre) => nombre.trim());
  assert.equal(cors["access-control-allow-origin"], "https://alexischocolate.github.io");
  for (const encabezado of ["content-type", "authorization", "x-unicom-llave", "x-unicom-firma"]) {
    assert.ok(permitidos.includes(encabezado), `falta ${encabezado}`);
  }
});

test("CORS no responde a una página de otro dominio", () => {
  assert.deepEqual(encabezadosCors(peticionDesde("https://pagina-ajena.example"), ORIGENES), {});
});
