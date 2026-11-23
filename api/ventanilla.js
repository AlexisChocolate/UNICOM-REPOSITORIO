import {
  AUTORIDAD_NACIONAL,
  CATEGORIAS,
  NIVELES,
  ROLES,
  TIPOS_OPINION,
  actualizarCasillero,
  autoridadPuedeRegistrar,
  casilleroDeMesa,
  crearGenesis,
  crearRaiz,
  crearRotacion,
  esHex,
  firmarDocumento,
  hojaLlena,
  huellaActa,
  llaveVigenteDeCadena,
  posicionesHermanas,
  siguienteRenglon,
  sumasDeVotos,
  validarFirmasDeActa,
  validarPaquete,
  vaciosPorNivel,
  verificarObjetoFirmado,
} from "../nucleo/index.js";
import { INDICES } from "../almacen/almacen-sql.js";

export class ErrorUnicom extends Error {
  constructor(estado, codigo, mensaje, detalles = undefined) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

const PARTIDOS = CATEGORIAS.filter((categoria) => /^P\d{2}$/.test(categoria));
const NOMBRES_AUTORIDAD = [AUTORIDAD_NACIONAL, ...PARTIDOS];
const DECISIONES = ["acepto_lectura", "mantuvo_lo_digitado", "corrigio"];
const MAXIMO_RENGLONES_POR_VOLCADO = 5000;
const PATRON_MOTIVO = /^[\x20-\x7e]{1,200}$/;

// La ventanilla única (arquitectura, sec. 1): todas las escrituras pasan por aquí y se atienden de una en una.
// Aunque el Durable Object sea una sola instancia, entre dos `await` a D1 podría entrar otra petición;
// por eso cada escritura espera en esta fila a que termine la anterior.
export class Ventanilla {
  constructor({ almacen, archivos = null, llaves, reloj = () => new Date() }) {
    this.almacen = almacen;
    this.archivos = archivos;
    this.llaves = new Map(llaves.map((llave) => [llave.llavePublica, llave.llavePrivada]));
    this.llavePorDefecto = llaves[0].llavePublica;
    this.reloj = reloj;
    this.fila = Promise.resolve();
    this.llaveVigenteEnMemoria = null;
  }

  enFila(tarea) {
    const resultado = this.fila.then(tarea);
    this.fila = resultado.catch(() => undefined);
    return resultado;
  }

  recibirActa(cuerpo) {
    return this.enFila(() => this.anotarActa(cuerpo));
  }

  registrarAutoridad(entrada) {
    return this.enFila(() => this.anotarAutoridad(entrada));
  }

  registrarEnPadron(cuerpo, { comoAdministrador = false } = {}) {
    return this.enFila(() => this.anotarEnPadron(cuerpo, comoAdministrador));
  }

  reemplazarLlave(firmado) {
    return this.enFila(() => this.anotarReemplazo(firmado));
  }

  registrarOpinion(firmado) {
    return this.enFila(() => this.anotarOpinion(firmado));
  }

  registrarLectura(lectura) {
    return this.enFila(() => this.anotarLectura(lectura));
  }

  registrarDecision(firmado) {
    return this.enFila(() => this.anotarDecision(firmado));
  }

  publicarRaiz({ soloSiCambio = false } = {}) {
    return this.enFila(() => this.anotarRaiz(soloSiCambio));
  }

  rotarLlave(pedido) {
    return this.enFila(() => this.anotarRotacion(pedido));
  }

  async llaveVigente() {
    if (!this.llaveVigenteEnMemoria) {
      const raices = await this.almacen.leerRaices(0, 100000);
      this.llaveVigenteEnMemoria = raices.length > 0 ? llaveVigenteDeCadena(raices) : this.llavePorDefecto;
    }
    const privada = this.llaves.get(this.llaveVigenteEnMemoria);
    if (!privada) {
      throw new ErrorUnicom(503, "llave_vigente_no_configurada", "El servidor no tiene la llave privada que la cadena de raíces marca como vigente", {
        llave_vigente: this.llaveVigenteEnMemoria,
      });
    }
    return { llavePublica: this.llaveVigenteEnMemoria, llavePrivada: privada };
  }

  async anotarRenglon(tipo, contenido, indice = null) {
    const ultimo = await this.almacen.ultimoRenglon();
    const renglon = await siguienteRenglon(ultimo, tipo, contenido);
    await this.almacen.guardarRenglon(renglon, indice ? [indice(renglon.numero)] : []);
    return renglon;
  }

  async anotarActa(cuerpo) {
    if (!cuerpo || typeof cuerpo !== "object") {
      throw new ErrorUnicom(400, "cuerpo_invalido", "Se esperaba un JSON con paquete y firmas");
    }
    const { paquete, firmas } = cuerpo;
    const erroresPaquete = validarPaquete(paquete);
    if (erroresPaquete.length > 0) {
      throw new ErrorUnicom(400, "paquete_invalido", "El paquete no cumple el formato", erroresPaquete);
    }
    let huellaDelActa;
    try {
      huellaDelActa = await huellaActa(paquete);
    } catch (error) {
      throw new ErrorUnicom(400, "paquete_invalido", error.message);
    }
    const erroresFirmas = validarFirmasDeActa(firmas, huellaDelActa);
    if (erroresFirmas.length > 0) {
      throw new ErrorUnicom(400, "firma_invalida", "Alguna firma no es válida", erroresFirmas);
    }
    await this.comprobarPadron(firmas, paquete.mesa);

    const reciboAnterior = await this.almacen.leerReciboPorHuella(huellaDelActa);
    if (reciboAnterior) {
      return { recibo: reciboAnterior, repetida: true, alertas: [] };
    }

    const actaVigente = await this.almacen.leerActa(paquete.mesa);
    if (actaVigente && paquete.reemplaza_a !== actaVigente.huella_acta) {
      throw new ErrorUnicom(409, "mesa_ya_registrada", "La mesa ya tiene un acta; para corregirla, reemplaza_a debe llevar su huella", {
        huella_acta_vigente: actaVigente.huella_acta,
      });
    }
    if (!actaVigente && paquete.reemplaza_a !== null) {
      throw new ErrorUnicom(409, "reemplazo_sin_acta", "reemplaza_a apunta a un acta que no está registrada para esta mesa");
    }

    const alertas = await this.alertasDeFoto(paquete);
    const casillero = casilleroDeMesa(paquete.mesa);
    const ultimo = await this.almacen.ultimoRenglon();
    const renglon = await siguienteRenglon(ultimo, "acta", { firmas, huella_acta: huellaDelActa, paquete });
    const hoja = await hojaLlena(casillero, huellaDelActa, sumasDeVotos(paquete.votos));
    const hermanos = await this.almacen.leerNodos(posicionesHermanas(casillero));
    const { nodos, raiz } = await actualizarCasillero({ casillero, hoja, hermanos });
    const { llavePrivada } = await this.llaveVigente();
    const recibo = await firmarDocumento(llavePrivada, {
      hora_llegada: this.reloj().toISOString(),
      huella_acta: huellaDelActa,
      huella_renglon: renglon.huella,
      mesa: paquete.mesa,
      renglon: renglon.numero,
      tipo: "recibo",
    });
    await this.almacen.guardarLlegada({
      renglon,
      recibo,
      acta: { mesa: paquete.mesa, casillero, huella_acta: huellaDelActa, renglon: renglon.numero, foto_sha256: paquete.foto_sha256 },
      nodos,
    });
    return { recibo, repetida: false, raiz_tablero: raiz, alertas };
  }

  // Las alertas avisan pero no frenan el acta (regla 1: el papel manda); quedan para el auditor y el Carril A.
  async alertasDeFoto(paquete) {
    const alertas = [];
    const otrasMesas = (await this.almacen.mesasConFoto(paquete.foto_sha256)).filter((mesa) => mesa !== paquete.mesa);
    if (otrasMesas.length > 0) {
      alertas.push({ codigo: "foto_repetida", mensaje: "La misma foto ya se usó en otra mesa", mesas: otrasMesas });
    }
    if (!(await this.almacen.leerFoto(paquete.foto_sha256))) {
      alertas.push({ codigo: "foto_no_subida", mensaje: "La foto todavía no está en el servidor; súbala con POST /fotos cuando haya señal" });
    }
    return alertas;
  }

  async comprobarPadron(firmas, mesa) {
    const llaves = firmas.map((firma) => firma.llave_publica);
    const [registros, reemplazos] = await Promise.all([this.almacen.leerPadron(llaves), this.almacen.leerReemplazos(llaves)]);
    const problemas = [];
    firmas.forEach((firma, posicion) => {
      const registro = registros[posicion];
      if (!registro) {
        problemas.push(`firmas[${posicion}]: la llave no está en el padrón`);
      } else if (reemplazos[posicion]) {
        problemas.push(`firmas[${posicion}]: la llave fue reemplazada y ya no puede firmar`);
      } else if (registro.rol !== firma.rol) {
        problemas.push(`firmas[${posicion}]: la llave está en el padrón como ${registro.rol}`);
      } else if (registro.rol === "miembro" && registro.mesa !== mesa) {
        problemas.push(`firmas[${posicion}]: el miembro de mesa está registrado en la mesa ${registro.mesa}`);
      }
    });
    if (problemas.length > 0) {
      throw new ErrorUnicom(403, "firmante_no_registrado", "Hay firmantes que no están en el padrón", problemas);
    }
  }

  async anotarAutoridad(entrada) {
    if (!entrada || !NOMBRES_AUTORIDAD.includes(entrada.nombre) || !esHex(entrada.llave_publica, 32)) {
      throw new ErrorUnicom(400, "autoridad_invalida", `nombre debe ser uno de ${NOMBRES_AUTORIDAD.join(", ")} y llave_publica 64 caracteres hexadecimales`);
    }
    const contenido = { llave_publica: entrada.llave_publica, nombre: entrada.nombre };
    const [existente] = await this.almacen.leerAutoridades([contenido.llave_publica]);
    if (existente) {
      throw new ErrorUnicom(409, "autoridad_ya_registrada", "Esa llave ya es de una autoridad", existente);
    }
    const renglon = await this.anotarRenglon("autoridad", contenido, (numero) => INDICES.autoridad(numero, contenido));
    return { renglon: renglon.numero, huella_renglon: renglon.huella, autoridad: contenido };
  }

  async anotarEnPadron(cuerpo, comoAdministrador) {
    const firmado = cuerpo && typeof cuerpo === "object" && cuerpo.firma !== undefined;
    const entradaRecibida = firmado ? cuerpo.contenido : cuerpo;
    const errores = validarEntradaPadron(entradaRecibida);
    if (errores.length > 0) {
      throw new ErrorUnicom(400, "padron_invalido", "La entrada del padrón no cumple el formato", errores);
    }
    const entrada = normalizarEntrada(entradaRecibida);
    if (firmado) {
      const objeto = { contenido: entrada, llave_publica: cuerpo.llave_publica, firma: cuerpo.firma };
      if (!(await verificarObjetoFirmado(objeto))) {
        throw new ErrorUnicom(400, "firma_invalida", "La firma de la autoridad no corresponde a esta entrada (se firma el JSON canónico de contenido)");
      }
      const [autoridad] = await this.almacen.leerAutoridades([objeto.llave_publica]);
      if (!autoridad) {
        throw new ErrorUnicom(403, "autoridad_desconocida", "La llave que firma no es de una autoridad registrada");
      }
      if (!autoridadPuedeRegistrar(autoridad, entrada)) {
        throw new ErrorUnicom(403, "autoridad_sin_permiso", `La autoridad ${autoridad.nombre} no puede registrar ese rol`);
      }
    } else if (!comoAdministrador) {
      throw new ErrorUnicom(401, "no_autorizado", "La entrada debe venir firmada por una autoridad o con la clave de administración");
    }
    const [existente] = await this.almacen.leerPadron([entrada.llave_publica]);
    if (existente) {
      throw new ErrorUnicom(409, "llave_ya_registrada", "Esa llave ya está en el padrón", existente);
    }
    const contenido = firmado ? { contenido: entrada, firma: cuerpo.firma, llave_publica: cuerpo.llave_publica } : entrada;
    const renglon = await this.anotarRenglon("padron", contenido, (numero) => INDICES.padron(numero, entrada));
    return { renglon: renglon.numero, huella_renglon: renglon.huella, entrada, provisional: !firmado };
  }

  async anotarReemplazo(firmado) {
    const contenido = firmado?.contenido;
    if (
      !contenido ||
      !esHex(contenido.llave_vieja, 32) ||
      !esHex(contenido.llave_nueva, 32) ||
      !PATRON_MOTIVO.test(String(contenido.motivo ?? "")) ||
      typeof contenido.mesa !== "string"
    ) {
      throw new ErrorUnicom(400, "reemplazo_invalido", "Se esperaba contenido {mesa, llave_vieja, llave_nueva, motivo} con motivo ASCII de hasta 200 caracteres");
    }
    if (!(await verificarObjetoFirmado(firmado))) {
      throw new ErrorUnicom(400, "firma_invalida", "La firma del reemplazo no es válida");
    }
    const [autoridad] = await this.almacen.leerAutoridades([firmado.llave_publica]);
    if (!autoridadPuedeRegistrar(autoridad, { rol: "miembro", mesa: contenido.mesa })) {
      throw new ErrorUnicom(403, "autoridad_sin_permiso", "Solo la ONPE puede reemplazar la llave de un miembro de mesa");
    }
    const [[vieja], [reemplazo], [nueva]] = await Promise.all([
      this.almacen.leerPadron([contenido.llave_vieja]),
      this.almacen.leerReemplazos([contenido.llave_vieja]),
      this.almacen.leerPadron([contenido.llave_nueva]),
    ]);
    if (!vieja || vieja.rol !== "miembro" || vieja.mesa !== contenido.mesa) {
      throw new ErrorUnicom(409, "llave_vieja_desconocida", "La llave vieja no es de un miembro de esa mesa");
    }
    if (reemplazo) {
      throw new ErrorUnicom(409, "llave_ya_reemplazada", "Esa llave ya fue reemplazada");
    }
    if (nueva) {
      throw new ErrorUnicom(409, "llave_ya_registrada", "La llave nueva ya está en el padrón");
    }
    const ultimo = await this.almacen.ultimoRenglon();
    const renglon = await siguienteRenglon(ultimo, "reemplazo_llave", firmado);
    await this.almacen.guardarRenglon(renglon, [
      INDICES.reemplazo(renglon.numero, contenido),
      INDICES.padron(renglon.numero, { llave_publica: contenido.llave_nueva, rol: "miembro", mesa: contenido.mesa, partido: null }),
    ]);
    return { renglon: renglon.numero, huella_renglon: renglon.huella };
  }

  async anotarOpinion(firmado) {
    const contenido = firmado?.contenido;
    if (
      !contenido ||
      !TIPOS_OPINION.includes(contenido.tipo) ||
      !esHex(contenido.huella_acta, 32) ||
      !PATRON_MOTIVO.test(String(contenido.motivo ?? ""))
    ) {
      throw new ErrorUnicom(400, "opinion_invalida", "Se esperaba contenido {tipo: objecion|respaldo, mesa, huella_acta, motivo}");
    }
    if (!(await verificarObjetoFirmado(firmado))) {
      throw new ErrorUnicom(400, "firma_invalida", "La firma de la opinión no es válida");
    }
    const [[firmante], [autoridad], acta] = await Promise.all([
      this.almacen.leerPadron([firmado.llave_publica]),
      this.almacen.leerAutoridades([firmado.llave_publica]),
      this.almacen.leerActa(contenido.mesa),
    ]);
    if (!firmante && !autoridad) {
      throw new ErrorUnicom(403, "firmante_no_registrado", "Quien opina debe estar en el padrón o ser una autoridad");
    }
    if (!acta) {
      throw new ErrorUnicom(404, "mesa_sin_acta", `La mesa ${contenido.mesa} no tiene acta`);
    }
    const ultimo = await this.almacen.ultimoRenglon();
    const renglon = await siguienteRenglon(ultimo, "opinion", firmado);
    await this.almacen.guardarRenglon(renglon, [INDICES.opinion(renglon.numero, contenido, firmado.llave_publica)]);
    return { renglon: renglon.numero, huella_renglon: renglon.huella, sobre_acta_vigente: acta.huella_acta === contenido.huella_acta };
  }

  async anotarLectura(lectura) {
    const contenido = {
      estado: lectura.estado,
      fecha: this.reloj().toISOString(),
      huella_foto: lectura.huellaFoto,
      llave_publica: lectura.llavePublica,
      mesa: lectura.mesa,
      modelo: lectura.modelo,
      momento: lectura.momento,
      resultado: lectura.resultado,
    };
    const renglon = await this.anotarRenglon("lectura_ia", contenido, (numero) => INDICES.lectura(numero, contenido));
    return { renglon: renglon.numero, huella_renglon: renglon.huella };
  }

  async anotarDecision(firmado) {
    const contenido = firmado?.contenido;
    if (!contenido || !Number.isSafeInteger(contenido.renglon_lectura) || !DECISIONES.includes(contenido.decision)) {
      throw new ErrorUnicom(400, "decision_invalida", `Se esperaba contenido {renglon_lectura, decision: ${DECISIONES.join("|")}}`);
    }
    if (!(await verificarObjetoFirmado(firmado))) {
      throw new ErrorUnicom(400, "firma_invalida", "La firma de la decisión no es válida");
    }
    const [lecturaRenglon] = await this.almacen.leerRenglones(contenido.renglon_lectura, 1, contenido.renglon_lectura);
    if (!lecturaRenglon || lecturaRenglon.tipo !== "lectura_ia") {
      throw new ErrorUnicom(404, "lectura_inexistente", "Ese renglón no es una lectura de IA");
    }
    const [firmante] = await this.almacen.leerPadron([firmado.llave_publica]);
    if (!firmante || firmante.rol !== "miembro" || firmante.mesa !== lecturaRenglon.contenido.mesa) {
      throw new ErrorUnicom(403, "firmante_no_registrado", "La decisión la firma un miembro de la misma mesa");
    }
    const renglon = await this.anotarRenglon("decision_lectura", firmado);
    return { renglon: renglon.numero, huella_renglon: renglon.huella };
  }

  async anotarRaiz(soloSiCambio) {
    const fecha = this.reloj().toISOString();
    const nuevas = [];
    let anterior = await this.almacen.ultimaRaiz();
    const ultimoRenglon = await this.almacen.ultimoRenglon();
    if (soloSiCambio && anterior && (anterior.contenido.renglones ?? 0) === (ultimoRenglon?.numero ?? 0)) {
      return { publicadas: [], motivo: "el cuaderno no cambió desde la última raíz" };
    }
    const { llavePublica, llavePrivada } = await this.llaveVigente();
    if (!anterior) {
      anterior = await crearGenesis(llavePrivada, llavePublica, fecha);
      nuevas.push(anterior);
    }
    const [nodoRaiz] = await this.almacen.leerNodos([{ nivel: NIVELES, indice: 0 }]);
    const raizTablero = nodoRaiz ?? (await vaciosPorNivel(CATEGORIAS.length))[NIVELES];
    const raiz = await crearRaiz(llavePrivada, { anterior, raizTablero, ultimoRenglon, fecha });
    nuevas.push(raiz);
    await this.almacen.guardarRaices(nuevas);
    await this.guardarVolcado(anterior, raiz);
    return { publicadas: nuevas };
  }

  // Volcado para los auditores (arquitectura, sec. 7.2): el cuaderno nuevo desde la raíz anterior.
  // Bajarlo de R2 no gasta las lecturas diarias de D1.
  async guardarVolcado(anterior, raiz) {
    if (!this.archivos) {
      return;
    }
    const desde = (anterior.contenido.renglones ?? 0) + 1;
    const renglones = await this.almacen.leerRenglones(desde, MAXIMO_RENGLONES_POR_VOLCADO, raiz.contenido.renglones);
    const volcado = { desde, hasta: raiz.contenido.renglones, raiz, renglones };
    const clave = `volcados/raiz-${String(raiz.contenido.numero).padStart(6, "0")}.json`;
    await this.archivos.guardar(clave, new TextEncoder().encode(JSON.stringify(volcado)), "application/json");
  }

  async anotarRotacion({ llavePublicaNueva, motivo }) {
    if (!this.llaves.has(llavePublicaNueva)) {
      throw new ErrorUnicom(400, "llave_nueva_no_configurada", "Primero configure la llave nueva como secreto LLAVE_SERVIDOR_NUEVA");
    }
    if (!PATRON_MOTIVO.test(String(motivo ?? ""))) {
      throw new ErrorUnicom(400, "motivo_invalido", "motivo debe ser texto ASCII de 1 a 200 caracteres");
    }
    const { llavePublica, llavePrivada } = await this.llaveVigente();
    if (llavePublica === llavePublicaNueva) {
      throw new ErrorUnicom(409, "misma_llave", "Esa llave ya es la vigente");
    }
    const anterior = await this.almacen.ultimaRaiz();
    if (!anterior) {
      throw new ErrorUnicom(409, "sin_genesis", "Publique primero una raíz para que exista la génesis");
    }
    const rotacion = await crearRotacion(llavePrivada, { anterior, llaveNueva: llavePublicaNueva, motivo, fecha: this.reloj().toISOString() });
    await this.almacen.guardarRaices([rotacion]);
    this.llaveVigenteEnMemoria = llavePublicaNueva;
    return { publicadas: [rotacion] };
  }
}

function validarEntradaPadron(entrada) {
  if (!entrada || typeof entrada !== "object") {
    return ["Se esperaba un objeto con rol, llave_publica y mesa o partido"];
  }
  const errores = [];
  if (!ROLES.includes(entrada.rol)) {
    errores.push('rol debe ser "miembro" o "personero"');
  }
  if (!esHex(entrada.llave_publica, 32)) {
    errores.push("llave_publica debe tener 64 caracteres hexadecimales");
  }
  if (entrada.rol === "miembro") {
    try {
      casilleroDeMesa(entrada.mesa);
    } catch (error) {
      errores.push(error.message);
    }
  }
  if (entrada.rol === "personero" && !PARTIDOS.includes(entrada.partido)) {
    errores.push(`partido debe ser el código de un partido: ${PARTIDOS.join(", ")}`);
  }
  return errores;
}

// La forma normalizada es la que se firma: así la web y el servidor calculan la misma huella.
export function normalizarEntrada(entrada) {
  return {
    llave_publica: entrada.llave_publica,
    mesa: entrada.rol === "miembro" ? entrada.mesa : null,
    partido: entrada.rol === "personero" ? entrada.partido : null,
    rol: entrada.rol,
  };
}
