import { CATEGORIAS } from "./acta.js";

const PARTIDOS = CATEGORIAS.filter((categoria) => /^P\d{2}$/.test(categoria));

function esEnteroValido(valor) {
  return Number.isSafeInteger(valor) && valor >= 0;
}

// Revisión de sumas del Paso 3: avisa, nunca bloquea, porque el error puede estar en el papel.
// Reglas tomadas del plan (Ley 32243, arts. 178 y 279; reglamento citado en la Res. 1052-2026-JNE, art. 9).
export function revisarSumas({ votos, electoresHabiles, ciudadanosVotaron, cedulasActaSufragio = null }) {
  const avisos = [];
  const avisar = (codigo, campo, mensaje) => avisos.push({ codigo, campo, mensaje });

  for (const categoria of CATEGORIAS) {
    const valor = votos?.[categoria];
    if (valor === undefined || valor === null || valor === "") {
      avisar("casilla_vacia", categoria, `La casilla ${categoria} está vacía`);
    } else if (!esEnteroValido(valor)) {
      avisar("no_es_entero", categoria, `La casilla ${categoria} debe ser un entero mayor o igual a 0`);
    }
  }
  for (const [campo, valor] of [
    ["electores_habiles", electoresHabiles],
    ["ciudadanos_votaron", ciudadanosVotaron],
  ]) {
    if (!esEnteroValido(valor)) {
      avisar("no_es_entero", campo, `${campo} debe ser un entero mayor o igual a 0`);
    }
  }
  if (avisos.length > 0) {
    return avisos;
  }

  const sumaVotos = CATEGORIAS.reduce((suma, categoria) => suma + votos[categoria], 0);
  if (sumaVotos !== ciudadanosVotaron) {
    avisar(
      "suma_no_cuadra",
      "ciudadanos_votaron",
      `Partidos + blancos + nulos + impugnados = ${sumaVotos}, pero votaron ${ciudadanosVotaron}`,
    );
  }
  if (ciudadanosVotaron > electoresHabiles) {
    avisar("votantes_mayor_que_habiles", "ciudadanos_votaron", `Votaron ${ciudadanosVotaron} pero hay ${electoresHabiles} electores hábiles`);
  }
  for (const categoria of CATEGORIAS) {
    if (votos[categoria] > electoresHabiles) {
      avisar("supera_habiles", categoria, `${categoria} (${votos[categoria]}) supera a los electores hábiles (${electoresHabiles})`);
    }
    if (votos[categoria] > ciudadanosVotaron) {
      avisar("supera_votantes", categoria, `${categoria} (${votos[categoria]}) supera a los ciudadanos que votaron (${ciudadanosVotaron})`);
    }
  }
  if (cedulasActaSufragio !== null) {
    if (!esEnteroValido(cedulasActaSufragio)) {
      avisar("no_es_entero", "cedulas_acta_sufragio", "El número de votantes del acta de sufragio debe ser un entero");
    } else if (cedulasActaSufragio !== sumaVotos) {
      avisar(
        "cedulas_no_coinciden",
        "cedulas_acta_sufragio",
        `Hay ${sumaVotos} cédulas contadas, pero el acta de sufragio registra ${cedulasActaSufragio} votantes`,
      );
    }
  }
  return avisos;
}

export const UMBRAL_CONFIANZA_PROVISIONAL = 0.8;

// Contraste del Paso 4: la IA solo advierte. Nunca cambia lo digitado.
export function contrastar(lectura, digitado, umbral = UMBRAL_CONFIANZA_PROVISIONAL) {
  if (!lectura) {
    return { estado: "lectura_pendiente", campos: {} };
  }
  const campos = {};
  for (const categoria of CATEGORIAS) {
    const leido = lectura[categoria];
    const valorDigitado = digitado[categoria];
    if (!leido || leido.valor === null || leido.valor === undefined) {
      campos[categoria] = { color: "amarillo", motivo: "no_legible", valor_ia: null, valor_digitado: valorDigitado };
    } else if (leido.valor !== valorDigitado) {
      campos[categoria] = { color: "rojo", motivo: "diferente", valor_ia: leido.valor, valor_digitado: valorDigitado };
    } else if (leido.tachon) {
      campos[categoria] = { color: "amarillo", motivo: "tachon", valor_ia: leido.valor, valor_digitado: valorDigitado };
    } else if (typeof leido.confianza !== "number" || leido.confianza < umbral) {
      campos[categoria] = { color: "amarillo", motivo: "poca_confianza", valor_ia: leido.valor, valor_digitado: valorDigitado };
    } else {
      campos[categoria] = { color: "verde", motivo: "coincide", valor_ia: leido.valor, valor_digitado: valorDigitado };
    }
  }
  const colores = Object.values(campos).map((campo) => campo.color);
  const estado = colores.includes("rojo") ? "rojo" : colores.includes("amarillo") ? "amarillo" : "verde";
  return { estado, campos };
}

export { PARTIDOS };
