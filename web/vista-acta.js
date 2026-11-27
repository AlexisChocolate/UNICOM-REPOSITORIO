import { cadenaConfiable, comprobacion, crear, estadoDeLaRaiz, fechaLegible, fotoVerificada, insignia, leerCuadernoCompleto, pedir, textoCorto } from "./comun.js";

const NOMBRES_ESTADO_LECTURA = { leida: "leída", lectura_pendiente: "lectura pendiente" };

export function tablaDeVotos(nucleo, votos) {
  const tabla = crear("table", "tabla-tarjetas");
  const cuerpo = crear("tbody");
  for (const categoria of nucleo.CATEGORIAS) {
    const fila = crear("tr");
    const nombre = crear("td", "", nucleo.NOMBRES_CATEGORIAS[categoria]);
    const cantidad = crear("td", "numero", String(votos[categoria]));
    nombre.setAttribute("data-titulo", "Casilla");
    cantidad.setAttribute("data-titulo", "Votos");
    fila.append(nombre, cantidad);
    cuerpo.append(fila);
  }
  tabla.append(cuerpo);
  return tabla;
}

// Todo lo que se muestra de un acta se vuelve a comprobar aquí con datos públicos, sin creerle al servidor (regla 6).
export async function examinarMesa(nucleo, mesa) {
  const [datos, renglones, cadena] = await Promise.all([pedir(`/actas/${mesa}`), leerCuadernoCompleto(), cadenaConfiable(nucleo)]);
  const estadoPublico = await nucleo.reconstruirEstado(renglones);
  const huellaRecalculada = await nucleo.huellaActa(datos.paquete);
  const firmasValidas = datos.firmas.length > 0 && nucleo.validarFirmasDeActa(datos.firmas, datos.huella_acta).length === 0;
  // El padrón se aplica renglón por renglón: un acta firmada antes de un reemplazo de llave sigue valiendo (sec. 5.2).
  const actaReconstruida = estadoPublico.actas.get(mesa);
  const problemasPadron = [];
  if (!actaReconstruida) {
    const delRenglon = estadoPublico.problemas.filter((problema) => problema.renglon === datos.renglon).map((problema) => problema.motivo);
    problemasPadron.push(...(delRenglon.length > 0 ? delRenglon : ["el cuaderno público no tiene un acta válida para esta mesa"]));
  } else if (actaReconstruida.huella_acta !== datos.huella_acta) {
    problemasPadron.push(`el servidor muestra un acta distinta de la vigente según el cuaderno (renglón ${actaReconstruida.renglon})`);
  }
  const incluida = await nucleo.verificarInclusion({
    casillero: datos.casillero,
    huellaActa: datos.huella_acta,
    sumas: datos.sumas,
    hermanos: datos.hermanos,
    raiz: datos.raiz,
  });
  const sumasCoinciden = nucleo.sumasDeVotos(datos.paquete.votos).every((cantidad, posicion) => cantidad === datos.sumas[posicion]);
  const foto = await fotoVerificada(nucleo, datos.paquete.foto_sha256);
  const precinto = datos.paquete.precinto_sha256 ? await fotoVerificada(nucleo, datos.paquete.precinto_sha256) : null;
  return {
    datos,
    huellaCoincide: huellaRecalculada === datos.huella_acta,
    firmasValidas,
    problemasPadron,
    incluida,
    sumasCoinciden,
    raiz: estadoDeLaRaiz(datos.raiz.huella, cadena),
    foto,
    precinto,
  };
}

function bloqueFoto(titulo, foto, huella) {
  const tarjeta = crear("div", "tarjeta");
  tarjeta.append(crear("h3", "", titulo));
  if (!foto?.encontrada) {
    tarjeta.append(comprobacion(null, "La foto todavía no está en el servidor", "Se puede buscar por su huella en otra copia (repositorio, celular de la mesa)."));
  } else {
    const imagen = crear("img", "vista-previa");
    imagen.src = foto.url;
    imagen.alt = titulo;
    tarjeta.append(
      comprobacion(foto.coincide, foto.coincide ? "La foto coincide con la huella sellada" : "La foto NO coincide con la huella sellada: fue cambiada"),
      imagen,
    );
  }
  tarjeta.append(crear("div", "huella", huella));
  return tarjeta;
}

export function pintarExamen(nucleo, contenedor, examen) {
  const { datos } = examen;
  const paquete = datos.paquete;
  const comprobaciones = [
    comprobacion(examen.huellaCoincide, "El contenido del acta coincide con su huella", "Tu navegador recalculó la huella del paquete sellado."),
    comprobacion(examen.firmasValidas, examen.firmasValidas ? `Las ${datos.firmas.length} firma(s) son auténticas` : "Alguna firma NO corresponde a este acta", "Firma Ed25519 verificada con @noble/curves."),
    comprobacion(
      examen.problemasPadron.length === 0,
      examen.problemasPadron.length === 0 ? "Quien firmó está en el padrón de esta mesa" : "Hay firmantes que no cuadran con el padrón",
      examen.problemasPadron.join("; ") || "Se comprobó con el padrón vigente en el renglón del acta, reconstruido desde el cuaderno público.",
    ),
    comprobacion(examen.incluida && examen.sumasCoinciden, examen.incluida ? "El acta está incluida en la raíz, con sus sumas" : "El camino de huellas NO llega a la raíz", `Casillero ${datos.casillero}: 17 huellas con sus sumas hasta la raíz.`),
    comprobacion(examen.raiz.estado, examen.raiz.titulo, examen.raiz.detalle),
  ];

  const insignias = crear("div", "estado-conexion");
  insignias.append(
    paquete.personeros_presentes ? insignia("ok", "Con personeros") : insignia("aviso", "Sin personero: la foto hace de testigo"),
    paquete.reemplaza_a ? insignia("aviso", `Corrige al acta ${textoCorto(paquete.reemplaza_a)}`) : insignia("", "Acta original"),
  );

  const lado = crear("div", "lado-a-lado");
  const numeros = crear("div", "tarjeta");
  numeros.append(crear("h3", "", "Paquete firmado por la mesa"), tablaDeVotos(nucleo, paquete.votos), crear("p", "nota", `Hora declarada por el celular: ${fechaLegible(paquete.fecha_hora_declarada)}`));
  lado.append(bloqueFoto("Foto del acta", examen.foto, paquete.foto_sha256), numeros);
  if (paquete.precinto_sha256) {
    const titulo = paquete.precinto_numero ? `Precinto n.º ${paquete.precinto_numero}` : "Precinto del sobre";
    lado.append(bloqueFoto(titulo, examen.precinto, paquete.precinto_sha256));
  }

  const extras = [];
  if (datos.lecturas_ia.length > 0) {
    const lista = crear("ul", "lista-simple");
    for (const lectura of datos.lecturas_ia) {
      lista.append(crear("li", "", `Renglón ${lectura.renglon} · ${NOMBRES_ESTADO_LECTURA[lectura.estado] ?? lectura.estado} · ${lectura.momento.replaceAll("_", " ")} · ${lectura.modelo}`));
    }
    extras.push(crear("h3", "", "Lecturas de la IA (anotadas aparte, no cambian el acta)"), lista);
  }
  extras.push(crear("h3", "", "Respaldos y objeciones"));
  if (datos.opiniones.length === 0) {
    extras.push(crear("p", "nota", "Nadie ha respaldado ni objetado esta acta todavía."));
  } else {
    const lista = crear("ul", "lista-simple");
    for (const opinion of datos.opiniones) {
      const fila = crear("li");
      const sobreVigente = opinion.huella_acta === datos.huella_acta;
      fila.append(
        insignia(opinion.tipo === "objecion" ? "mal" : "ok", opinion.tipo === "objecion" ? "Objeción" : "Respaldo"),
        document.createTextNode(` renglón ${opinion.renglon}${opinion.motivo ? ` · "${opinion.motivo}"` : ""}${sobreVigente ? "" : " · sobre un acta anterior"}`),
        crear("div", "huella", `Firmó: ${opinion.llave_publica}`),
      );
      lista.append(fila);
    }
    extras.push(lista);
  }

  contenedor.replaceChildren(...comprobaciones, insignias, lado, ...extras);
}
