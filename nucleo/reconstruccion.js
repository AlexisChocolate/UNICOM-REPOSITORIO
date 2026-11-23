import { CATEGORIAS, casilleroDeMesa, huellaActa, sumasDeVotos, validarFirmasDeActa, validarPaquete } from "./acta.js";
import { verificarObjetoFirmado } from "./firmados.js";

export const AUTORIDAD_NACIONAL = "ONPE";

export const TIPOS_OPINION = ["objecion", "respaldo"];

// Quién puede firmar qué en el padrón (Paso 0): la ONPE registra miembros de mesa;
// cada partido (o la ONPE) registra a sus personeros.
export function autoridadPuedeRegistrar(autoridad, entrada) {
  if (!autoridad) {
    return false;
  }
  if (autoridad.nombre === AUTORIDAD_NACIONAL) {
    return true;
  }
  return entrada.rol === "personero" && entrada.partido === autoridad.nombre;
}

export function estadoVacio() {
  return {
    autoridades: new Map(),
    padron: new Map(),
    reemplazadas: new Map(),
    actas: new Map(),
    opiniones: [],
    lecturas: new Map(),
    decisiones: [],
    problemas: [],
  };
}

// Recorre el cuaderno y vuelve a comprobar cada renglón con datos públicos solamente (Paso 9, revisión 2).
// No confía en lo que el servidor diga del padrón: lo reconstruye desde el cuaderno.
export async function aplicarRenglones(estado, renglones) {
  for (const renglon of renglones) {
    const problema = await aplicarRenglon(estado, renglon);
    if (problema) {
      estado.problemas.push({ renglon: renglon.numero, tipo: renglon.tipo, motivo: problema });
    }
  }
  return estado;
}

export async function reconstruirEstado(renglones) {
  return aplicarRenglones(estadoVacio(), renglones);
}

async function aplicarRenglon(estado, renglon) {
  const contenido = renglon.contenido;
  switch (renglon.tipo) {
    case "autoridad":
      if (estado.autoridades.has(contenido.llave_publica)) {
        return "autoridad repetida";
      }
      estado.autoridades.set(contenido.llave_publica, { nombre: contenido.nombre, renglon: renglon.numero });
      return null;
    case "padron":
      return aplicarPadron(estado, renglon);
    case "reemplazo_llave":
      return aplicarReemplazo(estado, renglon);
    case "acta":
      return aplicarActa(estado, renglon);
    case "opinion":
      return aplicarOpinion(estado, renglon);
    case "lectura_ia":
      estado.lecturas.set(renglon.numero, { ...contenido, renglon: renglon.numero });
      return null;
    case "decision_lectura":
      return aplicarDecision(estado, renglon);
    default:
      return `tipo de renglón desconocido: ${renglon.tipo}`;
  }
}

async function aplicarPadron(estado, renglon) {
  const contenido = renglon.contenido;
  // Los primeros renglones del piloto los cargó el administrador sin firma de una autoridad.
  const provisional = !contenido.firma;
  const entrada = provisional ? contenido : contenido.contenido;
  if (estado.padron.has(entrada.llave_publica)) {
    return "llave repetida en el padrón";
  }
  if (!provisional) {
    if (!(await verificarObjetoFirmado(contenido))) {
      return "firma de la autoridad inválida";
    }
    const resultado = comprobarFirmaDeAutoridad(estado, contenido, entrada);
    if (resultado) {
      return resultado;
    }
  }
  estado.padron.set(entrada.llave_publica, {
    rol: entrada.rol,
    mesa: entrada.mesa ?? null,
    partido: entrada.partido ?? null,
    renglon: renglon.numero,
    provisional,
  });
  return null;
}

function comprobarFirmaDeAutoridad(estado, firmado, entrada) {
  const autoridad = estado.autoridades.get(firmado.llave_publica);
  if (!autoridad) {
    return "lo firma una llave que no es de una autoridad";
  }
  if (!autoridadPuedeRegistrar(autoridad, entrada)) {
    return `la autoridad ${autoridad.nombre} no puede registrar ese rol`;
  }
  return null;
}

async function aplicarReemplazo(estado, renglon) {
  const firmado = renglon.contenido;
  if (!(await verificarObjetoFirmado(firmado))) {
    return "firma del reemplazo inválida";
  }
  const { mesa, llave_vieja: llaveVieja, llave_nueva: llaveNueva } = firmado.contenido;
  const anterior = estado.padron.get(llaveVieja);
  if (!anterior || anterior.rol !== "miembro" || anterior.mesa !== mesa) {
    return "la llave vieja no es de un miembro de esa mesa";
  }
  const problema = comprobarFirmaDeAutoridad(estado, firmado, { rol: "miembro", mesa });
  if (problema) {
    return problema;
  }
  if (estado.padron.has(llaveNueva)) {
    return "la llave nueva ya estaba en el padrón";
  }
  estado.reemplazadas.set(llaveVieja, { llaveNueva, renglon: renglon.numero });
  estado.padron.set(llaveNueva, { rol: "miembro", mesa, partido: null, renglon: renglon.numero, provisional: false });
  return null;
}

export function problemasDeFirmantes(estado, firmas, mesa) {
  const problemas = [];
  firmas.forEach((firma, posicion) => {
    const registro = estado.padron.get(firma.llave_publica);
    if (!registro) {
      problemas.push(`firmas[${posicion}]: la llave no está en el padrón`);
    } else if (estado.reemplazadas.has(firma.llave_publica)) {
      problemas.push(`firmas[${posicion}]: la llave fue reemplazada y ya no puede firmar`);
    } else if (registro.rol !== firma.rol) {
      problemas.push(`firmas[${posicion}]: la llave está en el padrón como ${registro.rol}`);
    } else if (registro.rol === "miembro" && registro.mesa !== mesa) {
      problemas.push(`firmas[${posicion}]: el miembro de mesa está registrado en la mesa ${registro.mesa}`);
    }
  });
  return problemas;
}

async function aplicarActa(estado, renglon) {
  const { paquete, firmas, huella_acta: huellaDelActa } = renglon.contenido;
  if (validarPaquete(paquete).length > 0) {
    return "paquete mal formado";
  }
  if ((await huellaActa(paquete)) !== huellaDelActa) {
    return "la huella del acta no coincide con su paquete";
  }
  const erroresFirmas = validarFirmasDeActa(firmas, huellaDelActa);
  if (erroresFirmas.length > 0) {
    return `firmas inválidas: ${erroresFirmas.join("; ")}`;
  }
  const problemasPadron = problemasDeFirmantes(estado, firmas, paquete.mesa);
  if (problemasPadron.length > 0) {
    return `firmantes fuera del padrón: ${problemasPadron.join("; ")}`;
  }
  const vigente = estado.actas.get(paquete.mesa);
  if ((vigente?.huella_acta ?? null) !== paquete.reemplaza_a) {
    return "reemplaza_a no apunta al acta vigente de la mesa";
  }
  estado.actas.set(paquete.mesa, {
    mesa: paquete.mesa,
    casillero: casilleroDeMesa(paquete.mesa),
    huella_acta: huellaDelActa,
    sumas: sumasDeVotos(paquete.votos),
    paquete,
    firmas,
    renglon: renglon.numero,
  });
  return null;
}

async function aplicarOpinion(estado, renglon) {
  const firmado = renglon.contenido;
  if (!(await verificarObjetoFirmado(firmado))) {
    return "firma de la opinión inválida";
  }
  const { tipo, mesa, huella_acta: huellaDelActa } = firmado.contenido;
  if (!TIPOS_OPINION.includes(tipo)) {
    return "tipo de opinión desconocido";
  }
  const firmante = estado.padron.get(firmado.llave_publica) ?? estado.autoridades.get(firmado.llave_publica);
  if (!firmante) {
    return "la opinión la firma alguien que no está en el padrón";
  }
  estado.opiniones.push({ ...firmado.contenido, llave_publica: firmado.llave_publica, renglon: renglon.numero, mesa, huella_acta: huellaDelActa });
  return null;
}

async function aplicarDecision(estado, renglon) {
  const firmado = renglon.contenido;
  if (!(await verificarObjetoFirmado(firmado))) {
    return "firma de la decisión inválida";
  }
  const lectura = estado.lecturas.get(firmado.contenido.renglon_lectura);
  if (!lectura) {
    return "la decisión apunta a una lectura que no existe";
  }
  const firmante = estado.padron.get(firmado.llave_publica);
  if (!firmante || firmante.rol !== "miembro" || firmante.mesa !== lectura.mesa) {
    return "la decisión no la firma un miembro de esa mesa";
  }
  estado.decisiones.push({ ...firmado.contenido, renglon: renglon.numero });
  return null;
}

export function hojasDelEstado(estado) {
  return [...estado.actas.values()].map((acta) => ({ casillero: acta.casillero, huellaActa: acta.huella_acta, sumas: acta.sumas }));
}

export function totalesDelEstado(estado) {
  const totales = Object.fromEntries(CATEGORIAS.map((categoria) => [categoria, 0]));
  for (const acta of estado.actas.values()) {
    CATEGORIAS.forEach((categoria, posicion) => {
      totales[categoria] += acta.sumas[posicion];
    });
  }
  return totales;
}
