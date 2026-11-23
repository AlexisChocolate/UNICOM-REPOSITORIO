import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditar } from "../auditor.js";
import { fuenteLocal } from "../fuentes.js";
import { investigar } from "../investigacion.js";
import { verificarSello } from "../anclaje.js";
import { alterarActaEnLaBase, pilotoDeJuliaca } from "../escenario.js";

test("un piloto honesto pasa las revisiones sin alertas", async () => {
  const { almacen, archivos } = await pilotoDeJuliaca();
  const informe = await auditar({ fuente: fuenteLocal({ almacen, archivos }) });
  assert.deepEqual(informe.alertas, []);
  assert.deepEqual(informe.resumen.totales, { P01: 295, P02: 321, blancos: 13, nulos: 13, impugnados: 1 });
  assert.equal(informe.arboles.length, 1);
});

test("un administrador cambia Sol 120 por 150 en la base: el auditor alerta y el detective encuentra la mesa 045123", async () => {
  const { almacen, archivos } = await pilotoDeJuliaca();
  const antes = await auditar({ fuente: fuenteLocal({ almacen, archivos }) });
  const arbolAnclado = antes.arboles[0];

  alterarActaEnLaBase(almacen);

  const despues = await auditar({ fuente: fuenteLocal({ almacen, archivos }), estadoPrevio: antes.nuevoEstado });
  const revisiones = new Set(despues.alertas.map((alerta) => alerta.revision));
  assert.ok(revisiones.has(1), "el cuaderno debe aparecer roto");
  assert.ok(revisiones.has(2), "la firma de Rosa debe aparecer rota");

  const investigacion = await investigar({ arbolAnclado, renglonesActuales: await almacen.leerRenglones(1, 1000) });
  assert.equal(investigacion.hallazgos.length, 1);
  const [hallazgo] = investigacion.hallazgos;
  assert.equal(hallazgo.casillero, 45123);
  assert.equal(hallazgo.veredicto, "firma_rota");
  assert.equal(hallazgo.votos_servidor.P01, 150);
  assert.ok(investigacion.comparaciones <= 2 * 17 + 1);
});

test("si el servidor cambia una raíz ya publicada en el repositorio, el auditor lo nota", async () => {
  const { almacen, archivos } = await pilotoDeJuliaca();
  const raices = await almacen.leerRaices(0, 10);
  const publicadaDistinta = structuredClone(raices[1]);
  publicadaDistinta.huella = "00".repeat(32);
  const informe = await auditar({ fuente: fuenteLocal({ almacen, archivos }), raicesDelRepositorio: [raices[0], publicadaDistinta] });
  assert.ok(informe.alertas.some((alerta) => alerta.revision === 5 && /dos versiones/.test(alerta.mensaje)));
});

test("si otro auditor vio otra raíz para el mismo número, hay alerta de vistas distintas", async () => {
  const { almacen, archivos } = await pilotoDeJuliaca();
  const informe = await auditar({
    fuente: fuenteLocal({ almacen, archivos }),
    vistasDeOtros: [{ auditor: "Universidad Nacional del Altiplano", raiz: { numero: 1, huella: "ab".repeat(32) } }],
  });
  assert.ok(informe.alertas.some((alerta) => alerta.revision === 5 && /versiones distintas/.test(alerta.mensaje)));
});

test("una foto cambiada en el servidor no coincide con la huella sellada", async () => {
  const { almacen, archivos } = await pilotoDeJuliaca();
  const [clave] = [...archivos.guardados.keys()].filter((nombre) => nombre.startsWith("fotos/"));
  archivos.guardados.get(clave).bytes = new TextEncoder().encode("foto editada");
  const informe = await auditar({ fuente: fuenteLocal({ almacen, archivos }) });
  assert.ok(informe.alertas.some((alerta) => alerta.revision === 3));
});

const datosBloque = JSON.parse(readFileSync(new URL("./datos/bloque-358391.json", import.meta.url), "utf8"));
const obtenerEncabezadoGuardado = async (altura) => (altura === datosBloque.altura ? { hash: datosBloque.hash, encabezado: datosBloque.encabezado } : null);

test("el sello oficial de ejemplo de OpenTimestamps se verifica contra el bloque 358391 de Bitcoin", async () => {
  const resultado = await verificarSello({
    bytesArchivo: readFileSync(new URL("./datos/hello-world.txt", import.meta.url)),
    bytesOts: readFileSync(new URL("./datos/hello-world.txt.ots", import.meta.url)),
    obtenerEncabezado: obtenerEncabezadoGuardado,
  });
  assert.equal(resultado.estado, "anclado");
  assert.equal(resultado.altura, 358391);
  assert.equal(resultado.fecha_bloque, "2015-05-28T15:41:18.000Z");
});

test("el sello no sirve para otro archivo", async () => {
  const resultado = await verificarSello({
    bytesArchivo: new TextEncoder().encode("Hello World?\n"),
    bytesOts: readFileSync(new URL("./datos/hello-world.txt.ots", import.meta.url)),
    obtenerEncabezado: obtenerEncabezadoGuardado,
  });
  assert.equal(resultado.estado, "invalido");
});
