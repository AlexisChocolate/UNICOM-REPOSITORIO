// Demostración del Paso 10 para la exposición, sin internet: piloto local de Juliaca, raíz anclada,
// un administrador corrupto cambia Sol 120 -> 150 en la base, el auditor alerta y el detective encuentra la mesa.
//
//   npm run simular-ataque
import { auditar } from "./auditor.js";
import { fuenteLocal } from "./fuentes.js";
import { investigar } from "./investigacion.js";
import { alterarActaEnLaBase, pilotoDeJuliaca } from "./escenario.js";

async function principal() {
  const { almacen, archivos } = await pilotoDeJuliaca();
  const fuente = fuenteLocal({ almacen, archivos });

  const antes = await auditar({ fuente });
  console.log("1. Piloto de Juliaca: 3 mesas y una raíz publicada; el auditor guarda la copia de su árbol.");
  console.log(`   Totales: ${JSON.stringify(antes.resumen.totales)}`);
  console.log(`   Auditor: ${antes.alertas.length === 0 ? "sin inconsistencias" : `${antes.alertas.length} alertas`}`);

  const renglon = alterarActaEnLaBase(almacen);
  console.log(`2. Ataque: se borra el candado de la tabla y se cambia Sol 120 -> 150 en el renglón ${renglon} (mesa 045123).`);

  const despues = await auditar({ fuente, estadoPrevio: antes.nuevoEstado });
  console.log(`3. El auditor lanza ${despues.alertas.length} alertas:`);
  for (const alerta of despues.alertas) {
    console.log(`   - revisión ${alerta.revision}: ${alerta.mensaje}`);
  }

  const investigacion = await investigar({ arbolAnclado: antes.arboles[0], renglonesActuales: await almacen.leerRenglones(1, 1000) });
  console.log(`4. El detective compara con el árbol anclado en ${investigacion.comparaciones} comparaciones:`);
  for (const hallazgo of investigacion.hallazgos) {
    console.log(`   - casillero ${hallazgo.casillero}, mesa ${hallazgo.mesa}: ${hallazgo.veredicto}`);
    console.log(`     prueba matemática: ${hallazgo.detalle}`);
    console.log(`     el servidor dice Sol ${hallazgo.votos_servidor.P01}; la foto sellada (${hallazgo.foto_sha256.slice(0, 16)}...) muestra lo que escribió la mesa`);
  }
}

principal().catch((error) => {
  console.error(`Falló: ${error.message}`);
  process.exitCode = 1;
});
