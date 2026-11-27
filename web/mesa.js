import {
  ErrorDeApi,
  agregarALista,
  borrarDeBase,
  bytesDeArchivo,
  comprobacion,
  crear,
  elemento,
  fechaLegible,
  fechaLocalIso,
  guardarEnBase,
  iniciarPagina,
  leerCuadernoCompleto,
  leerDeBase,
  leerLista,
  listarDeBase,
  cadenaConfiable,
  estadoDeLaRaiz,
  mensaje,
  mensajeDeError,
  pedir,
  textoCorto,
} from "./comun.js";

const CLAVE_SELLO = "miembro";
const CLAVE_RECIBOS = "unicom-recibos";
const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];
const LADO_MAXIMO_LECTURA = 1600;

const nucleo = await iniciarPagina();

const estado = {
  sello: null,
  foto: null,
  precinto: null,
  lectura: null,
  sellado: null,
  reemplazaA: null,
};

function mesaEscrita() {
  return elemento("mesa").value.trim();
}

function leerEntero(id) {
  const texto = elemento(id).value.trim();
  if (texto === "") {
    return null;
  }
  const numero = Number(texto);
  return Number.isSafeInteger(numero) ? numero : texto;
}

function leerVotos() {
  const votos = {};
  for (const categoria of nucleo.CATEGORIAS) {
    votos[categoria] = leerEntero(`voto-${categoria}`);
  }
  return votos;
}

function pintarCamposDeVotos() {
  const contenedor = elemento("votos");
  for (const categoria of nucleo.CATEGORIAS) {
    const campo = crear("div", "campo");
    const etiqueta = crear("label", "", nucleo.NOMBRES_CATEGORIAS[categoria]);
    etiqueta.htmlFor = `voto-${categoria}`;
    const entrada = crear("input");
    entrada.id = `voto-${categoria}`;
    entrada.type = "number";
    entrada.min = "0";
    entrada.step = "1";
    entrada.inputMode = "numeric";
    campo.append(etiqueta, entrada);
    contenedor.append(campo);
  }
}

function pintarSello() {
  const contenedor = elemento("sello-estado");
  if (!estado.sello) {
    contenedor.replaceChildren(mensaje("aviso", "Todavía no tienes un sello en este celular. Créalo antes de sellar el acta."));
    return;
  }
  contenedor.replaceChildren(
    comprobacion(true, `Sello de la mesa ${estado.sello.mesa}`, "Tu llave privada está guardada en este navegador y no se puede copiar."),
    crear("p", "nota", "Tu llave pública (la que va en el padrón):"),
    crear("div", "huella", estado.sello.llavePublica),
  );
}

async function cargarSello() {
  const guardado = await leerDeBase("llaves", CLAVE_SELLO).catch(() => null);
  if (guardado?.par && guardado.llavePublica) {
    estado.sello = guardado;
    elemento("mesa").value = guardado.mesa;
  }
  pintarSello();
}

async function crearSello() {
  const mesa = mesaEscrita();
  const contenedor = elemento("sello-estado");
  if (!/^\d{6}$/.test(mesa)) {
    contenedor.replaceChildren(mensaje("mal", "El número de mesa debe tener 6 dígitos, por ejemplo 045123."));
    return;
  }
  if (estado.sello && !confirm("Ya tienes un sello. Si creas otro, el anterior deja de servir en este celular y la ONPE tendrá que registrar un reemplazo de llave. ¿Seguir?")) {
    return;
  }
  let par;
  try {
    par = await nucleo.generarLlaveNoExportable();
  } catch {
    contenedor.replaceChildren(mensaje("mal", "Este navegador no permite firmas Ed25519 con Web Crypto. Usa un Chrome actual (arquitectura, sec. 5.1)."));
    return;
  }
  const llavePublica = await nucleo.llavePublicaHex(par.publicKey);
  estado.sello = { mesa, llavePublica, par, creado: new Date().toISOString() };
  await guardarEnBase("llaves", CLAVE_SELLO, estado.sello);
  pintarSello();
  await comprobarPadron();
}

// Vigilancia de la llave propia (Paso 0, idea de CONIKS): la app revisa sola que su llave figure en el padrón publicado.
async function comprobarPadron() {
  const contenedor = elemento("sello-estado");
  pintarSello();
  if (!estado.sello) {
    return;
  }
  try {
    const renglones = await leerCuadernoCompleto();
    const reconstruido = await nucleo.reconstruirEstado(renglones);
    const registro = reconstruido.padron.get(estado.sello.llavePublica);
    if (!registro) {
      contenedor.append(comprobacion(false, "Tu llave NO está en el padrón", "Pide a la ONPE que la registre. Sin eso, el servidor rechazará tu firma."));
    } else if (reconstruido.reemplazadas.has(estado.sello.llavePublica)) {
      contenedor.append(comprobacion(false, "Tu llave fue reemplazada", "Ya no puede firmar actas nuevas."));
    } else if (registro.rol !== "miembro" || registro.mesa !== estado.sello.mesa) {
      contenedor.append(comprobacion(false, "Tu llave está en el padrón con otros datos", `Figura como ${registro.rol} de la mesa ${registro.mesa ?? "ninguna"}.`));
    } else {
      const forma = registro.provisional ? "registro provisional del piloto" : "firmado por la ONPE";
      contenedor.append(comprobacion(true, `Tu llave está en el padrón de la mesa ${registro.mesa}`, `Renglón ${registro.renglon} del cuaderno (${forma}).`));
    }
  } catch (error) {
    contenedor.append(mensajeDeError(error));
  }
}

async function registrarProvisional() {
  const contenedor = elemento("registro-resultado");
  const campoClave = elemento("clave-admin");
  if (!estado.sello) {
    contenedor.replaceChildren(mensaje("mal", "Primero crea tu sello."));
    return;
  }
  const clave = campoClave.value.trim();
  campoClave.value = "";
  if (!clave) {
    contenedor.replaceChildren(mensaje("mal", "Escribe la clave de administración."));
    return;
  }
  try {
    const entrada = { rol: "miembro", mesa: estado.sello.mesa, partido: null, llave_publica: estado.sello.llavePublica };
    const respuesta = await pedir("/padron", { metodo: "POST", cuerpo: entrada, encabezados: { authorization: `Bearer ${clave}` } });
    contenedor.replaceChildren(mensaje("ok", `Llave registrada en el renglón ${respuesta.renglon} (provisional).`));
    await comprobarPadron();
  } catch (error) {
    contenedor.replaceChildren(mensajeDeError(error));
  }
}

async function leerFoto(entrada, destino, informacion) {
  const archivo = entrada.files[0];
  estado[destino] = null;
  if (destino === "foto") {
    descartarLectura("Cambiaste la foto: la lectura anterior ya no vale. Pide una nueva si quieres.");
  }
  invalidarSellado();
  if (!archivo) {
    informacion.replaceChildren();
    return;
  }
  if (!TIPOS_FOTO.includes(archivo.type)) {
    informacion.replaceChildren(mensaje("mal", "La foto debe ser JPG, PNG o WEBP."));
    return;
  }
  const bytes = await bytesDeArchivo(archivo);
  const huella = await nucleo.huellaHex(bytes);
  estado[destino] = { archivo, bytes, tipo: archivo.type, huella };
  const vista = crear("img", "vista-previa");
  vista.src = URL.createObjectURL(archivo);
  vista.alt = destino === "foto" ? "Foto del acta" : "Foto del precinto";
  informacion.replaceChildren(vista, crear("p", "nota", `Huella (${Math.round(bytes.length / 1024)} KB):`), crear("div", "huella", huella));
}

const NOMBRES_CAMPOS_EXTRA = {
  electores_habiles: "Electores hábiles",
  ciudadanos_votaron: "Ciudadanos que votaron",
  cedulas_acta_sufragio: "Votantes del acta de sufragio",
};

function textoLegible(texto) {
  const nombres = { ...nucleo.NOMBRES_CATEGORIAS, ...NOMBRES_CAMPOS_EXTRA };
  return texto.replace(/\b(P\d{2}|blancos|nulos|impugnados|electores_habiles|ciudadanos_votaron|cedulas_acta_sufragio)\b/g, (codigo) => nombres[codigo] ?? codigo);
}

function pintarAvisosDeSumas() {
  const contenedor = elemento("avisos-sumas");
  const ids = [...nucleo.CATEGORIAS.map((categoria) => `voto-${categoria}`), "electores-habiles", "ciudadanos-votaron"];
  if (ids.every((id) => elemento(id).value.trim() === "")) {
    contenedor.replaceChildren(crear("p", "nota", "Cuando digites los votos, aquí verás si las sumas cuadran."));
    return;
  }
  const avisos = nucleo.revisarSumas({
    votos: leerVotos(),
    electoresHabiles: leerEntero("electores-habiles"),
    ciudadanosVotaron: leerEntero("ciudadanos-votaron"),
    cedulasActaSufragio: leerEntero("cedulas-sufragio"),
  });
  if (avisos.length === 0) {
    contenedor.replaceChildren(comprobacion(true, "Las sumas cuadran"));
    return;
  }
  contenedor.replaceChildren(mensaje("aviso", "Revisa el papel (esto avisa, no bloquea):", avisos.map((aviso) => textoLegible(aviso.mensaje))));
}

function pintarContraste() {
  const contenedor = elemento("contraste");
  if (!estado.lectura) {
    contenedor.replaceChildren();
    return;
  }
  const resultado = nucleo.contrastar(estado.lectura.lectura ?? null, leerVotos());
  if (resultado.estado === "lectura_pendiente") {
    contenedor.replaceChildren();
    return;
  }
  const explicaciones = {
    coincide: "Coincide",
    diferente: "Diferente: revisa el papel",
    tachon: "Tiene tachón: revisa este campo",
    poca_confianza: "Poca confianza: revisa este campo",
    no_legible: "No se lee: revisa este campo",
  };
  const tabla = crear("table", "tabla-tarjetas");
  const cabecera = crear("thead");
  const filaCabecera = crear("tr");
  filaCabecera.append(crear("th", "", "Casilla"), crear("th", "numero", "Digitaste"), crear("th", "numero", "La IA leyó"), crear("th", "", "Resultado"));
  cabecera.append(filaCabecera);
  const cuerpo = crear("tbody");
  for (const categoria of nucleo.CATEGORIAS) {
    const campo = resultado.campos[categoria];
    const fila = crear("tr", `color-${campo.color}`);
    const celdas = [
      crear("td", "", nucleo.NOMBRES_CATEGORIAS[categoria]),
      crear("td", "numero", String(campo.valor_digitado ?? "—")),
      crear("td", "numero", String(campo.valor_ia ?? "—")),
      crear("td"),
    ];
    celdas[3].append(crear("span", `punto ${campo.color}`), document.createTextNode(explicaciones[campo.motivo]));
    ["Casilla", "Digitaste", "La IA leyó", "Resultado"].forEach((titulo, posicion) => celdas[posicion].setAttribute("data-titulo", titulo));
    fila.append(...celdas);
    cuerpo.append(fila);
  }
  tabla.append(cabecera, cuerpo);
  const resumen = {
    verde: comprobacion(true, "Todo coincide con la foto"),
    amarillo: comprobacion(null, "Hay campos que conviene revisar en el papel"),
    rojo: comprobacion(false, "Hay campos distintos de lo que leyó la IA: revisa el papel. Si el papel dice eso, puedes sellar igual."),
  };
  contenedor.replaceChildren(resumen[resultado.estado], tabla);
}

function bytesABase64(bytes) {
  let binario = "";
  for (let posicion = 0; posicion < bytes.length; posicion += 32768) {
    binario += String.fromCharCode(...bytes.subarray(posicion, posicion + 32768));
  }
  return btoa(binario);
}

// La foto se reduce con <canvas> antes de mandarla a la IA (Paso 4); la huella sellada siempre es la del original.
async function reducirParaLectura(archivo) {
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO_MAXIMO_LECTURA / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  lienzo.getContext("2d").drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  const reducida = await new Promise((resolver) => lienzo.toBlob(resolver, "image/jpeg", 0.85));
  return new Uint8Array(await reducida.arrayBuffer());
}

const MOTIVOS_PENDIENTE = {
  lector_no_configurado: "el servidor todavía no tiene la clave de Claude",
  lector_saturado: "Claude está saturado",
  lector_no_disponible: "Claude no está disponible",
  lector_rechazo_la_peticion: "Claude rechazó la petición",
  clave_del_lector_invalida: "la clave de Claude del servidor no es válida",
  lector_se_nego: "Claude no quiso leer la imagen",
  sin_conexion_con_el_lector: "el servidor no pudo hablar con Claude",
  respuesta_ilegible: "la respuesta de Claude no se pudo leer",
  respuesta_incompleta: "la respuesta de Claude vino incompleta",
  limite_de_lecturas_de_la_mesa: "la mesa ya usó sus 5 lecturas",
};

async function pedirLectura() {
  const contenedor = elemento("lectura-resultado");
  const boton = elemento("pedir-lectura");
  if (!estado.sello || !estado.foto) {
    contenedor.replaceChildren(mensaje("mal", "Necesitas tu sello (paso 0) y la foto del acta (paso 1)."));
    return;
  }
  boton.disabled = true;
  contenedor.replaceChildren(mensaje("", "Leyendo la foto…"));
  try {
    const reducida = await reducirParaLectura(estado.foto.archivo);
    const cuerpo = {
      mesa: estado.sello.mesa,
      momento: "antes_del_sello",
      fecha: new Date().toISOString(),
      huella_foto: estado.foto.huella,
      huella_imagen_enviada: await nucleo.huellaHex(reducida),
      tipo_imagen: "image/jpeg",
      imagen_base64: bytesABase64(reducida),
      llave_publica: estado.sello.llavePublica,
    };
    const huellaPeticion = await nucleo.huellaDeObjeto(nucleo.contenidoPeticionLectura(cuerpo));
    cuerpo.firma = await nucleo.firmarHuella(estado.sello.par.privateKey, huellaPeticion);
    const respuesta = await pedir("/lector", { metodo: "POST", cuerpo });
    estado.lectura = { ...respuesta, votosAlLeer: leerVotos() };
    if (respuesta.estado === "leida") {
      contenedor.replaceChildren(comprobacion(true, `Claude leyó la foto (${respuesta.modelo})`, `Anotado aparte en el renglón ${respuesta.renglon} del cuaderno; no entra al acta.`));
    } else {
      const motivo = MOTIVOS_PENDIENTE[respuesta.motivo] ?? respuesta.motivo;
      contenedor.replaceChildren(comprobacion(null, "Lectura pendiente", `No hubo lectura porque ${motivo}. Puedes sellar igual: la IA la leerá en la central y mientras tanto revisa una persona.`));
    }
  } catch (error) {
    estado.lectura = null;
    contenedor.replaceChildren(mensajeDeError(error), mensaje("aviso", "Puedes sellar igual: el acta queda con lectura pendiente."));
  } finally {
    boton.disabled = false;
  }
  pintarContraste();
}

function descartarLectura(motivo) {
  if (!estado.lectura) {
    return;
  }
  estado.lectura = null;
  elemento("lectura-resultado").replaceChildren(mensaje("aviso", motivo));
  pintarContraste();
}

// Solo cuenta como corrección cambiar una casilla que ya estaba digitada cuando la IA leyó:
// terminar de llenar casillas vacías no es corregir (el dato alimenta la medición del lector).
function decisionAnteLaLectura() {
  if (!estado.lectura?.renglon || estado.lectura.estado !== "leida") {
    return null;
  }
  const votos = leerVotos();
  const cambio = nucleo.CATEGORIAS.some((categoria) => {
    const alLeer = estado.lectura.votosAlLeer[categoria];
    return alLeer !== null && alLeer !== votos[categoria];
  });
  if (cambio) {
    return { renglon_lectura: estado.lectura.renglon, decision: "corrigio" };
  }
  const contraste = nucleo.contrastar(estado.lectura.lectura, votos);
  return { renglon_lectura: estado.lectura.renglon, decision: contraste.estado === "verde" ? "acepto_lectura" : "mantuvo_lo_digitado" };
}

function invalidarSellado() {
  if (!estado.sellado) {
    return;
  }
  estado.sellado = null;
  elemento("enviar").disabled = true;
  elemento("sello-resultado").replaceChildren(mensaje("aviso", "Cambiaste un dato después de sellar: vuelve a sellar. El paquete anterior sigue guardado abajo, en el paso 5, hasta que lo descartes."));
  pintarPendientes();
}

function pintarCorreccion() {
  const contenedor = elemento("correccion");
  if (!estado.reemplazaA) {
    contenedor.replaceChildren();
    return;
  }
  const quitar = crear("button", "secundario", "No es una corrección");
  quitar.type = "button";
  quitar.addEventListener("click", () => {
    estado.reemplazaA = null;
    invalidarSellado();
    pintarCorreccion();
  });
  contenedor.replaceChildren(mensaje("aviso", `Este paquete corrige al acta ya enviada ${textoCorto(estado.reemplazaA)}.`), quitar);
}

async function sellar() {
  const contenedor = elemento("sello-resultado");
  if (!estado.sello) {
    contenedor.replaceChildren(mensaje("mal", "Primero crea tu sello (paso 0)."));
    return;
  }
  if (mesaEscrita() !== estado.sello.mesa) {
    contenedor.replaceChildren(mensaje("mal", `Tu sello es de la mesa ${estado.sello.mesa}, no de la ${mesaEscrita()}.`));
    return;
  }
  if (!estado.foto) {
    contenedor.replaceChildren(mensaje("mal", "Falta la foto del acta (paso 1)."));
    return;
  }
  const numeroPrecinto = elemento("numero-precinto").value.trim();
  const paquete = {
    mesa: estado.sello.mesa,
    votos: leerVotos(),
    foto_sha256: estado.foto.huella,
    precinto_sha256: estado.precinto?.huella ?? null,
    precinto_numero: numeroPrecinto === "" ? null : numeroPrecinto,
    fecha_hora_declarada: fechaLocalIso(),
    personeros_presentes: elemento("personeros-presentes").checked,
    reemplaza_a: estado.reemplazaA,
  };
  const errores = nucleo.validarPaquete(paquete);
  if (errores.length > 0) {
    contenedor.replaceChildren(mensaje("mal", "El paquete todavía no se puede sellar:", errores));
    return;
  }
  let pendiente;
  try {
    const huella = await nucleo.huellaActa(paquete);
    const firma = await nucleo.firmarHuella(estado.sello.par.privateKey, huella);
    pendiente = {
      huella,
      paquete,
      firmas: [{ rol: "miembro", llave_publica: estado.sello.llavePublica, firma }],
      fotos: [estado.foto, estado.precinto].filter(Boolean).map(({ bytes, tipo, huella: huellaFoto }) => ({ bytes, tipo, huella: huellaFoto })),
      decision: decisionAnteLaLectura(),
      sellado: new Date().toISOString(),
    };
    await guardarEnBase("pendientes", huella, pendiente);
  } catch (error) {
    contenedor.replaceChildren(mensaje("mal", `No se pudo sellar: ${error.message}`, ["Si el navegador está en modo privado o se borraron sus datos, el sello pudo perderse: revisa el paso 0."]));
    return;
  }
  const huella = pendiente.huella;
  estado.sellado = pendiente;
  elemento("enviar").disabled = false;
  const avisos = [];
  if (!paquete.personeros_presentes) {
    avisos.push(mensaje("aviso", "Sin personero: el acta sigue su camino y la foto sellada hace de testigo."));
  } else {
    avisos.push(mensaje("aviso", "La cofirma del personero desde su propio celular todavía no está en esta app: el acta va solo con tu firma."));
  }
  if (!estado.lectura) {
    avisos.push(mensaje("aviso", "Sellaste sin lectura de la IA: queda como lectura pendiente."));
  }
  contenedor.replaceChildren(
    comprobacion(true, "Paquete sellado con tu firma", "Queda guardado en este celular hasta que se envíe."),
    crear("p", "nota", "Huella del acta:"),
    crear("div", "huella", huella),
    ...avisos,
  );
  pintarPendientes();
}

async function firmarFoto(foto) {
  return nucleo.firmarHuella(estado.sello.par.privateKey, foto.huella);
}

async function subirFotos(pendiente) {
  const problemas = [];
  for (const foto of pendiente.fotos) {
    try {
      await pedir("/fotos", {
        metodo: "POST",
        cuerpo: foto.bytes,
        crudo: true,
        encabezados: { "content-type": foto.tipo, "x-unicom-llave": estado.sello.llavePublica, "x-unicom-firma": await firmarFoto(foto) },
      });
    } catch (error) {
      if (error.codigo === "sin_conexion") {
        throw error;
      }
      problemas.push(`Foto ${textoCorto(foto.huella)}: ${error.message}`);
    }
  }
  return problemas;
}

async function enviarPendiente(pendiente) {
  const contenedor = elemento("envio-resultado");
  if (!estado.sello) {
    contenedor.replaceChildren(mensaje("mal", "No hay sello en este celular para firmar la subida de las fotos."));
    return;
  }
  contenedor.replaceChildren(mensaje("", "Enviando…"));
  let respuesta;
  let problemasFotos;
  try {
    problemasFotos = await subirFotos(pendiente);
    respuesta = await pedir("/actas", { metodo: "POST", cuerpo: { paquete: pendiente.paquete, firmas: pendiente.firmas } });
  } catch (error) {
    if (error instanceof ErrorDeApi && error.codigo === "mesa_ya_registrada") {
      ofrecerCorreccion(contenedor, error, pendiente);
      return;
    }
    const sinSenal = error.codigo === "sin_conexion";
    contenedor.replaceChildren(mensajeDeError(error), sinSenal ? mensaje("aviso", "El paquete sellado queda guardado aquí. Reintenta cuando haya señal.") : "");
    pintarPendientes();
    return;
  }
  const recibo = respuesta.recibo;
  const confianza = await cadenaConfiable(nucleo).catch((error) => ({ confiable: false, llave: null, aviso: error.message }));
  const firmaDelRecibo = confianza.confiable ? await nucleo.verificarDocumento(recibo, confianza.llave) : null;
  const esDeMiActa = recibo.contenido.huella_acta === pendiente.huella;
  agregarALista(CLAVE_RECIBOS, { mesa: pendiente.paquete.mesa, huella_acta: pendiente.huella, recibo, verificado: firmaDelRecibo === true && esDeMiActa, guardado: new Date().toISOString() });
  await borrarDeBase("pendientes", pendiente.huella);
  if (estado.sellado?.huella === pendiente.huella) {
    estado.sellado = null;
    estado.reemplazaA = null;
    elemento("enviar").disabled = true;
    pintarCorreccion();
  }
  const piezas = [
    comprobacion(true, respuesta.repetida ? "El servidor ya tenía esta acta: te devolvió el mismo recibo" : `Acta anotada en el renglón ${recibo.contenido.renglon}`, `Hora de llegada: ${fechaLegible(recibo.contenido.hora_llegada)}`),
    comprobacion(firmaDelRecibo, firmaDelRecibo === null ? "No se pudo comprobar la firma del recibo" : firmaDelRecibo ? "La firma del servidor en el recibo es válida" : "La firma del recibo NO es válida", confianza.aviso ?? `Comprobada con la llave de la ${confianza.origen}.`),
    comprobacion(esDeMiActa, esDeMiActa ? "El recibo es de tu acta" : "El recibo NO corresponde a la huella que firmaste"),
  ];
  for (const alerta of respuesta.alertas ?? []) {
    piezas.push(mensaje("aviso", alerta.mensaje, alerta.mesas ? [`Mesas: ${alerta.mesas.join(", ")}`] : undefined));
  }
  if (problemasFotos.length > 0) {
    piezas.push(mensaje("aviso", "Algunas fotos no se pudieron subir:", problemasFotos));
  }
  if (pendiente.decision) {
    piezas.push(await anotarDecision(pendiente.decision));
  }
  contenedor.replaceChildren(...piezas);
  pintarPendientes();
  pintarRecibos();
  await comprobarTablero();
}

async function anotarDecision(decision) {
  const textos = { acepto_lectura: "aceptó la lectura", mantuvo_lo_digitado: "mantuvo lo digitado", corrigio: "corrigió mirando el papel" };
  try {
    const firmado = await nucleo.firmarObjeto(estado.sello.par.privateKey, estado.sello.llavePublica, decision);
    const respuesta = await pedir("/decisiones", { metodo: "POST", cuerpo: firmado });
    return comprobacion(true, `Quedó anotado que una persona ${textos[decision.decision]}`, `Renglón ${respuesta.renglon} del cuaderno.`);
  } catch (error) {
    return mensaje("aviso", `No se pudo anotar tu decisión ante la lectura: ${error.message}`);
  }
}

function ofrecerCorreccion(contenedor, error, pendiente) {
  const vigente = error.detalles?.huella_acta_vigente;
  const boton = crear("button", "", "Preparar una corrección del acta vigente");
  boton.type = "button";
  boton.addEventListener("click", async () => {
    await borrarDeBase("pendientes", pendiente.huella);
    estado.reemplazaA = vigente;
    estado.sellado = null;
    elemento("enviar").disabled = true;
    pintarCorreccion();
    pintarPendientes();
    elemento("sello-resultado").replaceChildren(mensaje("aviso", "Vuelve a sellar: el paquete nuevo dirá que corrige al acta ya enviada."));
    const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    elemento("paso-sellar").scrollIntoView({ behavior: reducirMovimiento ? "auto" : "smooth" });
  });
  contenedor.replaceChildren(mensaje("mal", "Esta mesa ya tiene un acta en el servidor.", vigente ? [`Huella del acta vigente: ${vigente}`] : undefined));
  if (vigente) {
    contenedor.append(crear("p", "nota", "Si el papel dice otra cosa y quieres corregir, sella un paquete nuevo que indique a qué acta reemplaza."), boton);
  }
}

async function pintarPendientes() {
  const contenedor = elemento("pendientes");
  const pendientes = await listarDeBase("pendientes").catch(() => []);
  const otros = pendientes.filter((pendiente) => pendiente.huella !== estado.sellado?.huella);
  if (otros.length === 0) {
    contenedor.replaceChildren();
    return;
  }
  const lista = crear("ul", "lista-simple");
  for (const pendiente of otros) {
    const fila = crear("li");
    const reintentar = crear("button", "secundario", "Reintentar envío");
    reintentar.type = "button";
    reintentar.addEventListener("click", () => enviarPendiente(pendiente));
    const descartar = crear("button", "peligro", "Descartar");
    descartar.type = "button";
    descartar.addEventListener("click", async () => {
      if (!confirm(`¿Descartar el paquete sellado de la mesa ${pendiente.paquete.mesa}? Si no se envió, se pierde.`)) {
        return;
      }
      await borrarDeBase("pendientes", pendiente.huella);
      pintarPendientes();
    });
    const acciones = crear("div", "acciones");
    acciones.append(reintentar, descartar);
    fila.append(crear("strong", "", `Mesa ${pendiente.paquete.mesa} · sellada ${fechaLegible(pendiente.sellado)}`), crear("div", "huella", pendiente.huella), acciones);
    lista.append(fila);
  }
  contenedor.replaceChildren(crear("p", "nota", "Actas selladas que todavía no llegaron al servidor:"), lista);
}

function pintarRecibos() {
  const contenedor = elemento("recibos");
  const recibos = leerLista(CLAVE_RECIBOS);
  if (recibos.length === 0) {
    contenedor.replaceChildren(crear("p", "nota", "Todavía no hay recibos en este celular."));
    return;
  }
  const lista = crear("ul", "lista-simple");
  for (const guardado of [...recibos].reverse()) {
    const fila = crear("li");
    const descarga = crear("a", "boton secundario", "Descargar recibo");
    descarga.href = URL.createObjectURL(new Blob([JSON.stringify(guardado.recibo, null, 2)], { type: "application/json" }));
    descarga.download = `recibo-mesa-${guardado.mesa}-renglon-${guardado.recibo.contenido.renglon}.json`;
    fila.append(
      crear("strong", "", `Mesa ${guardado.mesa} · renglón ${guardado.recibo.contenido.renglon}`),
      crear("div", "nota", `Llegó: ${fechaLegible(guardado.recibo.contenido.hora_llegada)} · ${guardado.verificado ? "firma verificada" : "firma sin verificar"}`),
      crear("div", "huella", guardado.huella_acta),
      descarga,
    );
    lista.append(fila);
  }
  contenedor.replaceChildren(lista);
}

async function comprobarTablero() {
  const contenedor = elemento("tablero-resultado");
  const mesa = estado.sello?.mesa ?? mesaEscrita();
  if (!/^\d{6}$/.test(mesa)) {
    contenedor.replaceChildren(mensaje("mal", "El número de mesa debe tener 6 dígitos, por ejemplo 045123."));
    return;
  }
  contenedor.replaceChildren(mensaje("", `Comprobando la mesa ${mesa}…`));
  try {
    const [datos, cadena] = await Promise.all([pedir(`/actas/${mesa}`), cadenaConfiable(nucleo)]);
    const incluida = await nucleo.verificarInclusion({ casillero: datos.casillero, huellaActa: datos.huella_acta, sumas: datos.sumas, hermanos: datos.hermanos, raiz: datos.raiz });
    const huellaCoincide = (await nucleo.huellaActa(datos.paquete)) === datos.huella_acta;
    const misRecibos = leerLista(CLAVE_RECIBOS).filter((guardado) => guardado.mesa === mesa);
    const ultimoMio = misRecibos.at(-1);
    const piezas = [
      comprobacion(huellaCoincide, "El acta del servidor coincide con su huella"),
      comprobacion(incluida, incluida ? "Tu mesa está en el tablero, con su camino de huellas hasta la raíz" : "El camino de huellas NO llega a la raíz"),
    ];
    if (ultimoMio) {
      const esLaMia = ultimoMio.huella_acta === datos.huella_acta;
      piezas.push(comprobacion(esLaMia, esLaMia ? "Es la misma acta que enviaste desde este celular" : "El servidor muestra un acta distinta de la que enviaste: guarda tu recibo, es tu prueba"));
    }
    const raiz = estadoDeLaRaiz(datos.raiz.huella, cadena);
    piezas.push(comprobacion(raiz.estado, raiz.titulo, raiz.detalle), crear("p", "nota", "Raíz de la prueba:"), crear("div", "huella", datos.raiz.huella));
    contenedor.replaceChildren(...piezas);
  } catch (error) {
    contenedor.replaceChildren(mensajeDeError(error));
  }
}

if (nucleo) {
  pintarCamposDeVotos();
  await cargarSello();
  if (estado.sello) {
    comprobarPadron();
  }
  elemento("crear-sello").addEventListener("click", crearSello);
  elemento("comprobar-padron").addEventListener("click", comprobarPadron);
  elemento("registrar-provisional").addEventListener("click", registrarProvisional);
  elemento("foto-acta").addEventListener("change", (evento) => leerFoto(evento.target, "foto", elemento("foto-acta-info")));
  elemento("foto-precinto").addEventListener("change", (evento) => leerFoto(evento.target, "precinto", elemento("foto-precinto-info")));
  for (const id of ["votos", "electores-habiles", "ciudadanos-votaron", "cedulas-sufragio", "numero-precinto", "personeros-presentes"]) {
    elemento(id).addEventListener("input", () => {
      invalidarSellado();
      pintarAvisosDeSumas();
      pintarContraste();
    });
  }
  elemento("pedir-lectura").addEventListener("click", pedirLectura);
  elemento("sellar").addEventListener("click", sellar);
  elemento("enviar").addEventListener("click", () => estado.sellado && enviarPendiente(estado.sellado));
  elemento("comprobar-tablero").addEventListener("click", comprobarTablero);
  pintarAvisosDeSumas();
  pintarPendientes();
  pintarRecibos();
}
