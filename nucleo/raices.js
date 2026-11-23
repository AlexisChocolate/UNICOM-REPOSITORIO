import { CATEGORIAS, totalesConNombre } from "./acta.js";
import { HUELLA_INICIAL } from "./cuaderno.js";
import { firmarDocumento, verificarDocumento } from "./firmas.js";
import { NIVELES } from "./tablero.js";

// La génesis fija en público la llave del servidor y las reglas del tablero (arquitectura, sec. 5.3):
// una vez anclada, nadie puede cambiarlas sin que se note.
export function contenidoGenesis({ llavePublicaServidor, fecha }) {
  return {
    categorias: CATEGORIAS,
    fecha,
    huella_raiz_anterior: HUELLA_INICIAL,
    llave_publica_servidor: llavePublicaServidor,
    niveles: NIVELES,
    numero: 0,
    sistema: "UNICOM",
    tipo: "genesis",
  };
}

// Cada raíz lleva la huella de la anterior, como CONIKS (Melara et al., 2015, sec. 3.3): una sola cadena.
export function contenidoRaiz({ anterior, raizTablero, ultimoRenglon, fecha }) {
  return {
    fecha,
    huella_cuaderno: ultimoRenglon ? ultimoRenglon.huella : HUELLA_INICIAL,
    huella_raiz_anterior: anterior.huella,
    numero: anterior.contenido.numero + 1,
    raiz_tablero: raizTablero.huella,
    renglones: ultimoRenglon ? ultimoRenglon.numero : 0,
    tipo: "raiz",
    totales: totalesConNombre(raizTablero.sumas),
  };
}

// Rotación de la llave del servidor (arquitectura, sec. 5.3): la firma la llave vieja y anuncia la nueva.
// Desde la raíz siguiente, todo se verifica con la llave nueva; lo anterior, con la vieja.
export function contenidoRotacion({ anterior, llaveNueva, motivo, fecha }) {
  return {
    fecha,
    huella_raiz_anterior: anterior.huella,
    llave_nueva: llaveNueva,
    motivo,
    numero: anterior.contenido.numero + 1,
    renglones: anterior.contenido.renglones ?? 0,
    tipo: "rotacion",
  };
}

export async function crearRotacion(llavePrivadaVieja, datos) {
  return firmarDocumento(llavePrivadaVieja, contenidoRotacion(datos));
}

export function llaveVigenteDeCadena(raices) {
  let llave = raices[0]?.contenido?.llave_publica_servidor ?? null;
  for (const raiz of raices) {
    if (raiz.contenido.tipo === "rotacion") {
      llave = raiz.contenido.llave_nueva;
    }
  }
  return llave;
}

export async function crearGenesis(llavePrivada, llavePublicaServidor, fecha) {
  return firmarDocumento(llavePrivada, contenidoGenesis({ llavePublicaServidor, fecha }));
}

export async function crearRaiz(llavePrivada, datos) {
  return firmarDocumento(llavePrivada, contenidoRaiz(datos));
}

export async function verificarCadenaRaices(raices, llavePublicaEsperada = null) {
  if (raices.length === 0) {
    return { valida: false, motivo: "la cadena está vacía" };
  }
  const genesis = raices[0];
  if (genesis.contenido?.tipo !== "genesis" || genesis.contenido.numero !== 0) {
    return { valida: false, numero: 0, motivo: "la primera raíz no es la génesis" };
  }
  const llavePublica = genesis.contenido.llave_publica_servidor;
  if (llavePublicaEsperada !== null && llavePublica !== llavePublicaEsperada) {
    return { valida: false, numero: 0, motivo: "la génesis no tiene la llave del servidor esperada" };
  }
  if (genesis.contenido.huella_raiz_anterior !== HUELLA_INICIAL) {
    return { valida: false, numero: 0, motivo: "la génesis debe apuntar a la huella inicial" };
  }
  let llaveVigente = llavePublica;
  for (let posicion = 0; posicion < raices.length; posicion++) {
    const raiz = raices[posicion];
    if (!(await verificarDocumento(raiz, llaveVigente))) {
      return { valida: false, numero: raiz.contenido?.numero, motivo: "la firma o la huella no cuadran" };
    }
    if (posicion === 0) {
      continue;
    }
    const anterior = raices[posicion - 1];
    if (!["raiz", "rotacion"].includes(raiz.contenido.tipo) || raiz.contenido.numero !== anterior.contenido.numero + 1) {
      return { valida: false, numero: raiz.contenido.numero, motivo: "hay un salto en la numeración" };
    }
    if (raiz.contenido.huella_raiz_anterior !== anterior.huella) {
      return { valida: false, numero: raiz.contenido.numero, motivo: "no lleva la huella de la raíz anterior" };
    }
    if (raiz.contenido.renglones < (anterior.contenido.renglones ?? 0)) {
      return { valida: false, numero: raiz.contenido.numero, motivo: "el cuaderno se achicó" };
    }
    if (raiz.contenido.tipo === "rotacion") {
      llaveVigente = raiz.contenido.llave_nueva;
    }
  }
  return { valida: true, llavePublica, llaveVigente, ultima: raices[raices.length - 1] };
}

// Cada recibo se verifica con la llave que estaba vigente en su renglón.
export function llaveParaRenglon(raices, renglon) {
  let llave = raices[0]?.contenido?.llave_publica_servidor ?? null;
  for (const raiz of raices) {
    if (raiz.contenido.tipo === "rotacion" && raiz.contenido.renglones < renglon) {
      llave = raiz.contenido.llave_nueva;
    }
  }
  return llave;
}
