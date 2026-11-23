import OpenTimestamps from "opentimestamps";
import { bytesAHex, huellaHex, verificarEncabezadoBitcoin } from "../nucleo/index.js";

// API Esplora: mempool.space es la que nombra el plan; blockstream.info expone la misma API y sirve de respaldo.
export const EXPLORADORES = ["https://mempool.space/api", "https://blockstream.info/api"];

export function exploradorEsplora(bases = EXPLORADORES) {
  return async function obtenerEncabezado(altura) {
    for (const base of bases) {
      try {
        const hash = (await (await fetch(`${base}/block-height/${altura}`)).text()).trim();
        const encabezado = (await (await fetch(`${base}/block/${hash}/header`)).text()).trim();
        if (/^[0-9a-f]{64}$/.test(hash) && /^[0-9a-f]{160}$/.test(encabezado)) {
          return { hash, encabezado };
        }
      } catch {
        continue;
      }
    }
    return null;
  };
}

// Verificación del sello sin nodo Bitcoin (arquitectura, sec. 7.3): javascript-opentimestamps recorre el camino
// de huellas; el resultado debe ser la raíz de Merkle del bloque (bytes 36 a 68 del encabezado de 80 bytes),
// y el encabezado debe tener el hash del bloque a esa altura.
export async function verificarSello({ bytesArchivo, bytesOts, obtenerEncabezado }) {
  let sello;
  try {
    sello = OpenTimestamps.DetachedTimestampFile.deserialize(bytesOts);
  } catch (error) {
    return { estado: "invalido", motivo: `el archivo .ots no se puede leer: ${error.message}` };
  }
  const huellaArchivo = await huellaHex(bytesArchivo);
  if (bytesAHex(sello.fileDigest()) !== huellaArchivo) {
    return { estado: "invalido", motivo: "el .ots es de otro archivo" };
  }
  const atestaciones = [...sello.timestamp.allAttestations()];
  const bitcoin = atestaciones.filter(([, atestacion]) => atestacion instanceof OpenTimestamps.Notary.BitcoinBlockHeaderAttestation);
  if (bitcoin.length === 0) {
    return { estado: "pendiente", motivo: "el sello todavía espera su bloque de Bitcoin; correr ots upgrade más tarde" };
  }
  const fallas = [];
  for (const [mensaje, atestacion] of bitcoin) {
    const bloque = await obtenerEncabezado(atestacion.height);
    if (!bloque) {
      fallas.push(`no se pudo obtener el bloque ${atestacion.height}`);
      continue;
    }
    if (!(await verificarEncabezadoBitcoin(bloque.encabezado, bloque.hash))) {
      fallas.push(`el encabezado del bloque ${atestacion.height} no corresponde a su hash`);
      continue;
    }
    const raizMerkle = bloque.encabezado.slice(72, 136);
    if (bytesAHex(mensaje) !== raizMerkle) {
      fallas.push(`el camino de huellas no llega a la raíz de Merkle del bloque ${atestacion.height}`);
      continue;
    }
    const segundos = new DataView(new Uint8Array(bloque.encabezado.slice(136, 144).match(/../g).map((par) => parseInt(par, 16))).buffer).getUint32(0, true);
    return { estado: "anclado", altura: atestacion.height, hash_bloque: bloque.hash, fecha_bloque: new Date(segundos * 1000).toISOString() };
  }
  return { estado: "invalido", motivo: fallas.join("; ") };
}
