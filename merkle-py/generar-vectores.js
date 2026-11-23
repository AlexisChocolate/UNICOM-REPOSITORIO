// Genera vectores de prueba con la implementación de JavaScript para comparar con la de Python.
//
//   node merkle-py/generar-vectores.js
import { writeFileSync } from "node:fs";
import { CATEGORIAS, NIVELES, construirTablero, huellaHex, posicionesHermanas, vaciosPorNivel } from "../nucleo/index.js";

async function huellaDeTexto(texto) {
  return huellaHex(new TextEncoder().encode(texto));
}

async function casos() {
  const juliaca = [
    { casillero: 45120, huellaActa: await huellaDeTexto("acta 045120, Juliaca"), sumas: [98, 110, 5, 3, 0] },
    { casillero: 45123, huellaActa: await huellaDeTexto("acta 045123, Juliaca"), sumas: [120, 80, 6, 4, 1] },
    { casillero: 45124, huellaActa: await huellaDeTexto("acta 045124, Juliaca"), sumas: [77, 131, 2, 6, 0] },
  ];
  const extremos = [
    { casillero: 0, huellaActa: await huellaDeTexto("primer casillero"), sumas: [0, 0, 0, 0, 0] },
    { casillero: 131071, huellaActa: await huellaDeTexto("ultimo casillero"), sumas: [2 ** 53 - 1, 1, 2, 3, 4] },
  ];
  const puno = [];
  for (let numero = 0; numero < 200; numero++) {
    const casillero = 40000 + numero * 37;
    puno.push({ casillero, huellaActa: await huellaDeTexto(`acta ${casillero}, Puno`), sumas: [numero, 200 - numero, numero % 7, numero % 5, numero % 3] });
  }
  return [
    { nombre: "tablero vacío", hojas: [] },
    { nombre: "tres mesas de Juliaca", hojas: juliaca },
    { nombre: "casilleros extremos y suma máxima", hojas: extremos },
    { nombre: "200 mesas de Puno", hojas: puno },
  ];
}

async function principal() {
  const vacios = await vaciosPorNivel(CATEGORIAS.length);
  const vectores = [];
  for (const caso of await casos()) {
    const tablero = await construirTablero(caso.hojas, CATEGORIAS.length);
    const casilleroProbado = caso.hojas[0]?.casillero ?? null;
    vectores.push({
      nombre: caso.nombre,
      hojas: caso.hojas.map(({ casillero, huellaActa, sumas }) => ({ casillero, huella_acta: huellaActa, sumas })),
      raiz: tablero.raiz,
      prueba:
        casilleroProbado === null
          ? null
          : {
              casillero: casilleroProbado,
              hermanos: posicionesHermanas(casilleroProbado).map(({ nivel, indice }) => tablero.nodo(nivel, indice) ?? vacios[nivel]),
            },
    });
  }
  const archivo = new URL("./vectores.json", import.meta.url);
  writeFileSync(archivo, JSON.stringify({ categorias: CATEGORIAS, niveles: NIVELES, vacios, vectores }, null, 2) + "\n");
  console.log(`Vectores guardados: ${vectores.length}`);
}

principal().catch((error) => {
  console.error(`Falló: ${error.message}`);
  process.exitCode = 1;
});
