import { almacenLocal } from "../almacen/local.js";
import { archivosEnMemoria } from "../almacen/archivos.js";
import { Ventanilla, normalizarEntrada } from "../api/ventanilla.js";
import { subirFoto } from "../api/fotos.js";
import { firmarHuella, firmarObjeto, generarLlaveNoExportable, huellaActa, huellaHex, llavePublicaHex } from "../nucleo/index.js";

const MESAS_DE_JULIACA = [
  { mesa: "045120", votos: { P01: 98, P02: 110, blancos: 5, nulos: 3, impugnados: 0 } },
  { mesa: "045123", votos: { P01: 120, P02: 80, blancos: 6, nulos: 4, impugnados: 1 } },
  { mesa: "045124", votos: { P01: 77, P02: 131, blancos: 2, nulos: 6, impugnados: 0 } },
];

async function nuevaLlave() {
  const llaves = await generarLlaveNoExportable();
  return { privada: llaves.privateKey, publica: await llavePublicaHex(llaves.publicKey) };
}

// Un piloto pequeño en una base local: ONPE, tres mesas de Juliaca con sus fotos y una raíz publicada.
// Lo usan las pruebas del auditor y la demostración del ataque.
export async function pilotoDeJuliaca({ reloj = () => new Date("2026-11-27T21:30:00.000Z") } = {}) {
  const almacen = almacenLocal();
  const archivos = archivosEnMemoria();
  const servidor = await nuevaLlave();
  const ventanilla = new Ventanilla({ almacen, archivos, llaves: [{ llavePrivada: servidor.privada, llavePublica: servidor.publica }], reloj });
  const onpe = await nuevaLlave();
  await ventanilla.registrarAutoridad({ nombre: "ONPE", llave_publica: onpe.publica });
  for (const { mesa, votos } of MESAS_DE_JULIACA) {
    const miembro = await nuevaLlave();
    await ventanilla.registrarEnPadron(await firmarObjeto(onpe.privada, onpe.publica, normalizarEntrada({ rol: "miembro", mesa, llave_publica: miembro.publica })));
    const foto = new TextEncoder().encode(`foto del acta ${mesa}, Juliaca: Sol ${votos.P01}, Rio ${votos.P02}`);
    const huellaFoto = await huellaHex(foto);
    await subirFoto({ bytes: foto, tipo: "image/jpeg", llavePublica: miembro.publica, firma: await firmarHuella(miembro.privada, huellaFoto), almacen, archivos, ahora: reloj() });
    const paquete = {
      mesa,
      votos,
      foto_sha256: huellaFoto,
      precinto_sha256: null,
      precinto_numero: null,
      fecha_hora_declarada: "2026-11-27T16:05:00-05:00",
      personeros_presentes: false,
      reemplaza_a: null,
    };
    const huellaDelActa = await huellaActa(paquete);
    await ventanilla.recibirActa({ paquete, firmas: [{ rol: "miembro", llave_publica: miembro.publica, firma: await firmarHuella(miembro.privada, huellaDelActa) }] });
  }
  await ventanilla.publicarRaiz();
  return { almacen, archivos, ventanilla, servidor };
}

// Ataque del Paso 10: un administrador corrupto borra el candado de la tabla y cambia Sol 120 -> 150
// en el acta de la mesa 045123, directamente en la base, y recalcula el tablero para que "cuadre".
export function alterarActaEnLaBase(almacen, { mesa = "045123", nuevoValorSol = 150 } = {}) {
  const base = almacen.base;
  base.exec("DROP TRIGGER cuaderno_sin_cambios");
  const fila = base.prepare("SELECT numero, contenido FROM cuaderno WHERE tipo = 'acta' AND json_extract(contenido, '$.paquete.mesa') = ?").get(mesa);
  const contenido = JSON.parse(fila.contenido);
  contenido.paquete.votos.P01 = nuevoValorSol;
  base.prepare("UPDATE cuaderno SET contenido = ? WHERE numero = ?").run(JSON.stringify(contenido), fila.numero);
  return fila.numero;
}
