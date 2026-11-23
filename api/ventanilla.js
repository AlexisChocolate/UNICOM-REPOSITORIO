import {
  CATEGORIAS,
  ROLES,
  actualizarCasillero,
  casilleroDeMesa,
  crearGenesis,
  crearRaiz,
  esHex,
  firmarDocumento,
  hojaLlena,
  huellaActa,
  posicionesHermanas,
  siguienteRenglon,
  sumasDeVotos,
  validarFirmasDeActa,
  validarPaquete,
  vaciosPorNivel,
  NIVELES,
} from "../nucleo/index.js";

export class ErrorUnicom extends Error {
  constructor(estado, codigo, mensaje, detalles = undefined) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

// La ventanilla única (arquitectura, sec. 1): todas las escrituras pasan por aquí y se atienden de una en una.
// Aunque el Durable Object sea una sola instancia, entre dos `await` a D1 podría entrar otra petición;
// por eso cada escritura espera en esta fila a que termine la anterior.
export class Ventanilla {
  constructor({ almacen, llavePrivada, llavePublica, reloj = () => new Date() }) {
    this.almacen = almacen;
    this.llavePrivada = llavePrivada;
    this.llavePublica = llavePublica;
    this.reloj = reloj;
    this.fila = Promise.resolve();
  }

  enFila(tarea) {
    const resultado = this.fila.then(tarea);
    this.fila = resultado.catch(() => undefined);
    return resultado;
  }

  recibirActa(cuerpo) {
    return this.enFila(() => this.anotarActa(cuerpo));
  }

  registrarEnPadron(entrada) {
    return this.enFila(() => this.anotarEnPadron(entrada));
  }

  publicarRaiz() {
    return this.enFila(() => this.anotarRaiz());
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
      return { recibo: reciboAnterior, repetida: true };
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

    const casillero = casilleroDeMesa(paquete.mesa);
    const ultimo = await this.almacen.ultimoRenglon();
    const renglon = await siguienteRenglon(ultimo, "acta", { firmas, huella_acta: huellaDelActa, paquete });
    const hoja = await hojaLlena(casillero, huellaDelActa, sumasDeVotos(paquete.votos));
    const hermanos = await this.almacen.leerNodos(posicionesHermanas(casillero));
    const { nodos, raiz } = await actualizarCasillero({ casillero, hoja, hermanos });
    const recibo = await firmarDocumento(this.llavePrivada, {
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
      acta: { mesa: paquete.mesa, casillero, huella_acta: huellaDelActa, renglon: renglon.numero },
      nodos,
    });
    return { recibo, repetida: false, raiz_tablero: raiz };
  }

  async comprobarPadron(firmas, mesa) {
    const registros = await this.almacen.leerPadron(firmas.map((firma) => firma.llave_publica));
    const problemas = [];
    firmas.forEach((firma, posicion) => {
      const registro = registros[posicion];
      if (!registro) {
        problemas.push(`firmas[${posicion}]: la llave no está en el padrón`);
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

  async anotarEnPadron(entrada) {
    const errores = validarEntradaPadron(entrada);
    if (errores.length > 0) {
      throw new ErrorUnicom(400, "padron_invalido", "La entrada del padrón no cumple el formato", errores);
    }
    const normalizada = {
      llave_publica: entrada.llave_publica,
      mesa: entrada.rol === "miembro" ? entrada.mesa : null,
      partido: entrada.rol === "personero" ? entrada.partido : null,
      rol: entrada.rol,
    };
    const [existente] = await this.almacen.leerPadron([normalizada.llave_publica]);
    if (existente) {
      throw new ErrorUnicom(409, "llave_ya_registrada", "Esa llave ya está en el padrón", existente);
    }
    const ultimo = await this.almacen.ultimoRenglon();
    const renglon = await siguienteRenglon(ultimo, "padron", normalizada);
    await this.almacen.guardarPadron({ renglon, entrada: normalizada });
    return { renglon: renglon.numero, huella_renglon: renglon.huella, entrada: normalizada };
  }

  async anotarRaiz() {
    const fecha = this.reloj().toISOString();
    const nuevas = [];
    let anterior = await this.almacen.ultimaRaiz();
    if (!anterior) {
      anterior = await crearGenesis(this.llavePrivada, this.llavePublica, fecha);
      nuevas.push(anterior);
    }
    const [nodoRaiz] = await this.almacen.leerNodos([{ nivel: NIVELES, indice: 0 }]);
    const raizTablero = nodoRaiz ?? (await vaciosPorNivel(CATEGORIAS.length))[NIVELES];
    const ultimoRenglon = await this.almacen.ultimoRenglon();
    const raiz = await crearRaiz(this.llavePrivada, { anterior, raizTablero, ultimoRenglon, fecha });
    nuevas.push(raiz);
    await this.almacen.guardarRaices(nuevas);
    return { publicadas: nuevas };
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
  if (entrada.rol === "personero" && !CATEGORIAS.filter((categoria) => /^P\d{2}$/.test(categoria)).includes(entrada.partido)) {
    errores.push("partido debe ser el código de un partido, por ejemplo \"P01\"");
  }
  return errores;
}
