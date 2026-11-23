import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIAS, NOMBRES_CATEGORIAS, contenidoPeticionLectura, esHex, huellaDeObjeto, huellaHex, verificarFirmaDeHuella } from "../nucleo/index.js";
import { ErrorUnicom } from "./ventanilla.js";

// Un solo lector (regla 2): el modelo más avanzado de Claude. No se agrega un modelo de respaldo
// ("fallbacks") a propósito: si Claude no lee, el acta queda en "lectura pendiente" y la mira una persona,
// para que todas las mesas se midan con la misma vara (Paso 4).
export const MODELO_LECTOR = "claude-fable-5-2";
export const LECTURAS_POR_MESA = 5;
export const MINUTOS_DE_VALIDEZ = 5;
export const MOMENTOS = ["antes_del_sello", "despues_del_sello"];
const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp"];
const BYTES_MAXIMOS_IMAGEN = 5 * 1024 * 1024;

const ESQUEMA_LECTURA = {
  type: "object",
  properties: Object.fromEntries(
    CATEGORIAS.map((categoria) => [
      categoria,
      {
        type: "object",
        properties: {
          legible: { type: "boolean" },
          valor: { type: "integer" },
          confianza: { type: "number" },
          tachon: { type: "boolean" },
        },
        required: ["legible", "valor", "confianza", "tachon"],
        additionalProperties: false,
      },
    ]),
  ),
  required: CATEGORIAS,
  additionalProperties: false,
};

const INSTRUCCIONES = [
  "Eres el lector de actas de escrutinio de UNICOM, un sistema de vigilancia electoral del Perú.",
  "Recibes la foto de un acta escrita a mano. Lee la cantidad de votos de cada casilla y devuélvela en el JSON pedido.",
  "Casillas que debes leer:",
  ...CATEGORIAS.map((categoria) => `- ${categoria}: ${NOMBRES_CATEGORIAS[categoria]}`),
  "Para cada casilla: legible indica si pudiste leer el número; valor es el entero que leíste (0 si no es legible);",
  "confianza va de 0 a 1 y dice qué tan seguro estás; tachon es true si el número tiene tachones, borrones o correcciones.",
  "Lee solo lo que está escrito en la foto. No corrijas sumas ni completes casillas: si una casilla está vacía o no se lee, márcala como no legible.",
].join("\n");

function base64ABytes(texto) {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let posicion = 0; posicion < binario.length; posicion++) {
    bytes[posicion] = binario.charCodeAt(posicion);
  }
  return bytes;
}

// Candado del lector (arquitectura, sec. 5.4): firma de una llave del padrón, hora reciente,
// petición de un solo uso y límite de lecturas por mesa.
export async function comprobarPeticion({ cuerpo, almacen, ahora }) {
  if (!cuerpo || typeof cuerpo !== "object") {
    throw new ErrorUnicom(400, "cuerpo_invalido", "Se esperaba un JSON");
  }
  if (!MOMENTOS.includes(cuerpo.momento) || !/^\d{6}$/.test(String(cuerpo.mesa))) {
    throw new ErrorUnicom(400, "peticion_invalida", `mesa debe tener 6 dígitos y momento ser ${MOMENTOS.join(" o ")}`);
  }
  if (!TIPOS_IMAGEN.includes(cuerpo.tipo_imagen) || typeof cuerpo.imagen_base64 !== "string") {
    throw new ErrorUnicom(400, "imagen_invalida", `tipo_imagen debe ser ${TIPOS_IMAGEN.join(", ")} e imagen_base64 un texto base64`);
  }
  if (!esHex(cuerpo.huella_foto, 32) || !esHex(cuerpo.huella_imagen_enviada, 32)) {
    throw new ErrorUnicom(400, "peticion_invalida", "huella_foto y huella_imagen_enviada deben ser huellas SHA-256 en hexadecimal");
  }
  let imagen;
  try {
    imagen = base64ABytes(cuerpo.imagen_base64);
  } catch {
    throw new ErrorUnicom(400, "imagen_invalida", "imagen_base64 no es base64 válido");
  }
  if (imagen.length > BYTES_MAXIMOS_IMAGEN) {
    throw new ErrorUnicom(413, "imagen_muy_grande", "Reduzca la foto con <canvas> antes de enviarla (máximo 5 MB)");
  }
  if ((await huellaHex(imagen)) !== cuerpo.huella_imagen_enviada) {
    throw new ErrorUnicom(400, "imagen_no_coincide", "La imagen enviada no corresponde a huella_imagen_enviada");
  }
  const momentoPeticion = Date.parse(cuerpo.fecha);
  if (!Number.isFinite(momentoPeticion) || Math.abs(ahora.getTime() - momentoPeticion) > MINUTOS_DE_VALIDEZ * 60 * 1000) {
    throw new ErrorUnicom(400, "peticion_vencida", `La fecha de la petición debe estar a menos de ${MINUTOS_DE_VALIDEZ} minutos de la hora del servidor`);
  }
  const huellaPeticion = await huellaDeObjeto(contenidoPeticionLectura(cuerpo));
  if (!verificarFirmaDeHuella(cuerpo.firma, huellaPeticion, cuerpo.llave_publica)) {
    throw new ErrorUnicom(400, "firma_invalida", "La firma no corresponde a esta petición");
  }
  const [[registro], [reemplazo]] = await Promise.all([
    almacen.leerPadron([cuerpo.llave_publica]),
    almacen.leerReemplazos([cuerpo.llave_publica]),
  ]);
  if (!registro || registro.rol !== "miembro" || registro.mesa !== cuerpo.mesa || reemplazo) {
    throw new ErrorUnicom(403, "firmante_no_registrado", "Solo un miembro de mesa del padrón puede pedir lecturas de su propia mesa");
  }
  if (!(await almacen.usarPeticion(huellaPeticion, ahora.toISOString()))) {
    throw new ErrorUnicom(409, "peticion_repetida", "Esta petición firmada ya se usó; firme una nueva");
  }
  return { imagen, huellaPeticion };
}

function normalizarLectura(salida) {
  const lectura = {};
  for (const categoria of CATEGORIAS) {
    const campo = salida?.[categoria];
    if (!campo || typeof campo !== "object") {
      return null;
    }
    const confianza = Math.min(1, Math.max(0, Number(campo.confianza) || 0));
    lectura[categoria] = {
      valor: campo.legible && Number.isSafeInteger(campo.valor) && campo.valor >= 0 ? campo.valor : null,
      confianza,
      tachon: Boolean(campo.tachon),
    };
  }
  return lectura;
}

// En el cuaderno solo caben enteros (JSON canónico): la confianza se guarda en milésimas.
export function lecturaParaCuaderno(lectura) {
  if (!lectura) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(lectura).map(([categoria, campo]) => [
      categoria,
      { confianza_milesimas: Math.round(campo.confianza * 1000), tachon: campo.tachon, valor: campo.valor },
    ]),
  );
}

export async function leerConClaude({ cliente, imagenBase64, tipoImagen }) {
  let respuesta;
  try {
    respuesta = await cliente.messages.create({
      model: MODELO_LECTOR,
      max_tokens: 16000,
      system: INSTRUCCIONES,
      output_config: { effort: "high", format: { type: "json_schema", schema: ESQUEMA_LECTURA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: tipoImagen, data: imagenBase64 } },
            { type: "text", text: "Lee esta acta y devuelve las cantidades de cada casilla." },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { estado: "lectura_pendiente", motivo: "lector_saturado" };
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return { estado: "lectura_pendiente", motivo: "clave_del_lector_invalida" };
    }
    if (error instanceof Anthropic.APIError) {
      return { estado: "lectura_pendiente", motivo: error.status >= 500 ? "lector_no_disponible" : "lector_rechazo_la_peticion" };
    }
    return { estado: "lectura_pendiente", motivo: "sin_conexion_con_el_lector" };
  }
  if (respuesta.stop_reason === "refusal") {
    return { estado: "lectura_pendiente", motivo: "lector_se_nego" };
  }
  const texto = respuesta.content.find((bloque) => bloque.type === "text")?.text;
  let salida;
  try {
    salida = JSON.parse(texto);
  } catch {
    return { estado: "lectura_pendiente", motivo: "respuesta_ilegible" };
  }
  const lectura = normalizarLectura(salida);
  if (!lectura) {
    return { estado: "lectura_pendiente", motivo: "respuesta_incompleta" };
  }
  return { estado: "leida", lectura };
}

export async function atenderLectura({ cuerpo, almacen, ventanilla, cliente, ahora }) {
  await comprobarPeticion({ cuerpo, almacen, ahora });
  let resultado;
  if (!cliente) {
    resultado = { estado: "lectura_pendiente", motivo: "lector_no_configurado" };
  } else if ((await almacen.contarLecturas(cuerpo.mesa)) >= LECTURAS_POR_MESA) {
    resultado = { estado: "lectura_pendiente", motivo: "limite_de_lecturas_de_la_mesa" };
  } else {
    resultado = await leerConClaude({ cliente, imagenBase64: cuerpo.imagen_base64, tipoImagen: cuerpo.tipo_imagen });
  }
  const anotada = await ventanilla.registrarLectura({
    estado: resultado.estado,
    huellaFoto: cuerpo.huella_foto,
    llavePublica: cuerpo.llave_publica,
    mesa: cuerpo.mesa,
    modelo: MODELO_LECTOR,
    momento: cuerpo.momento,
    resultado: resultado.estado === "leida" ? lecturaParaCuaderno(resultado.lectura) : { motivo: resultado.motivo },
  });
  return { ...resultado, modelo: MODELO_LECTOR, renglon: anotada.renglon };
}
