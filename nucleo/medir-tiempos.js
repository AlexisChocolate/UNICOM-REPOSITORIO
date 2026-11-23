// Mediciones del tablero (Paso 8) para el informe: cuánto tarda cada operación en esta computadora.
//
//   node nucleo/medir-tiempos.js
import { performance } from "node:perf_hooks";
import {
  CATEGORIAS,
  actualizarCasillero,
  construirTablero,
  hojaLlena,
  huellaHex,
  posicionesHermanas,
  vaciosPorNivel,
  verificarInclusion,
} from "./index.js";

async function hojasDePrueba(cantidad) {
  const hojas = [];
  for (let numero = 0; numero < cantidad; numero++) {
    const casillero = (numero * 7919) % 131072;
    hojas.push({ casillero, huellaActa: await huellaHex(new TextEncoder().encode(`acta ${casillero}`)), sumas: [numero % 300, 200, 5, 3, 1] });
  }
  return hojas;
}

async function medir(nombre, repeticiones, tarea) {
  const inicio = performance.now();
  for (let vez = 0; vez < repeticiones; vez++) {
    await tarea();
  }
  const milisegundos = (performance.now() - inicio) / repeticiones;
  return `${nombre}: ${milisegundos.toFixed(2)} ms`;
}

async function principal() {
  const resultados = [];
  for (const cantidad of [1000, 10000, 90000]) {
    const hojas = await hojasDePrueba(cantidad);
    let tablero;
    resultados.push(await medir(`construir el tablero completo con ${cantidad} actas`, 1, async () => {
      tablero = await construirTablero(hojas, CATEGORIAS.length);
    }));
    const vacios = await vaciosPorNivel(CATEGORIAS.length);
    const casillero = hojas[0].casillero;
    const hermanos = posicionesHermanas(casillero).map(({ nivel, indice }) => tablero.nodo(nivel, indice) ?? vacios[nivel]);
    resultados.push(await medir(`  actualizar una mesa (17 nodos) con ${cantidad} actas`, 200, async () => {
      await actualizarCasillero({ casillero, hoja: await hojaLlena(casillero, hojas[0].huellaActa, [121, 200, 5, 3, 1]), hermanos });
    }));
    resultados.push(await medir(`  verificar una prueba de inclusión con ${cantidad} actas`, 200, async () => {
      await verificarInclusion({ ...hojas[0], hermanos, raiz: tablero.raiz });
    }));
  }
  for (const linea of resultados) {
    console.log(linea);
  }
}

principal().catch((error) => {
  console.error(`Falló: ${error.message}`);
  process.exitCode = 1;
});
