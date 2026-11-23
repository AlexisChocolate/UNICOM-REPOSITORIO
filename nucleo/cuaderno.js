import { huellaDeObjeto } from "./huellas.js";

export const HUELLA_INICIAL = "0".repeat(64);

export const TIPOS_RENGLON = ["padron", "acta"];

export async function crearRenglon({ numero, tipo, huellaAnterior, contenido }) {
  const renglon = { contenido, huella_anterior: huellaAnterior, numero, tipo };
  return { ...renglon, huella: await huellaDeObjeto(renglon) };
}

export async function siguienteRenglon(ultimo, tipo, contenido) {
  return crearRenglon({
    numero: ultimo ? ultimo.numero + 1 : 1,
    tipo,
    huellaAnterior: ultimo ? ultimo.huella : HUELLA_INICIAL,
    contenido,
  });
}

// Encadenar huellas como Haber y Stornetta (1991): borrar o cambiar un renglón rompe todos los siguientes.
export async function verificarCuaderno(renglones, anterior = null) {
  let previo = anterior;
  for (const renglon of renglones) {
    const numeroEsperado = previo ? previo.numero + 1 : 1;
    const huellaAnteriorEsperada = previo ? previo.huella : HUELLA_INICIAL;
    if (renglon.numero !== numeroEsperado) {
      return { valido: false, renglon: renglon.numero, motivo: `se esperaba el renglón ${numeroEsperado}` };
    }
    if (renglon.huella_anterior !== huellaAnteriorEsperada) {
      return { valido: false, renglon: renglon.numero, motivo: "no lleva la huella del renglón anterior" };
    }
    const recalculada = await huellaDeObjeto({
      contenido: renglon.contenido,
      huella_anterior: renglon.huella_anterior,
      numero: renglon.numero,
      tipo: renglon.tipo,
    });
    if (recalculada !== renglon.huella) {
      return { valido: false, renglon: renglon.numero, motivo: "su huella no coincide con su contenido" };
    }
    previo = renglon;
  }
  return { valido: true, ultimo: previo ? { numero: previo.numero, huella: previo.huella } : null };
}
