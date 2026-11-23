// Capa de almacén (arquitectura, sec. 1): la ventanilla y la API solo hablan con esta clase.
// Debajo va un conductor de D1 (Cloudflare) o de SQLite local (plan B), con el mismo SQL.
//
// Un conductor expone:
//   consultar(lista de {sql, parametros}) -> lista de filas por consulta, todas de la misma foto de la base
//   escribir(lista de {sql, parametros})  -> aplica todo o nada

export function sentencia(sql, ...parametros) {
  return { sql, parametros };
}

function renglonDesdeFila(fila) {
  return {
    numero: fila.numero,
    tipo: fila.tipo,
    huella_anterior: fila.huella_anterior,
    contenido: JSON.parse(fila.contenido),
    huella: fila.huella,
  };
}

function nodoDesdeFila(fila) {
  return fila ? { huella: fila.huella, sumas: JSON.parse(fila.sumas) } : null;
}

function sentenciaRenglon(renglon) {
  return sentencia(
    "INSERT INTO cuaderno (numero, tipo, huella_anterior, contenido, huella) VALUES (?, ?, ?, ?, ?)",
    renglon.numero,
    renglon.tipo,
    renglon.huella_anterior,
    JSON.stringify(renglon.contenido),
    renglon.huella,
  );
}

export const INDICES = {
  autoridad: (renglon, { nombre, llave_publica: llavePublica }) =>
    sentencia("INSERT INTO autoridades (llave_publica, nombre, renglon) VALUES (?, ?, ?)", llavePublica, nombre, renglon),
  padron: (renglon, entrada) =>
    sentencia(
      "INSERT INTO padron (llave_publica, rol, mesa, partido, renglon) VALUES (?, ?, ?, ?, ?)",
      entrada.llave_publica,
      entrada.rol,
      entrada.mesa ?? null,
      entrada.partido ?? null,
      renglon,
    ),
  reemplazo: (renglon, { llave_vieja: llaveVieja, llave_nueva: llaveNueva }) =>
    sentencia("INSERT INTO reemplazos (llave_vieja, llave_nueva, renglon) VALUES (?, ?, ?)", llaveVieja, llaveNueva, renglon),
  opinion: (renglon, { mesa, huella_acta: huellaDelActa, tipo }, llavePublica) =>
    sentencia(
      "INSERT INTO opiniones (renglon, mesa, huella_acta, tipo, llave_publica) VALUES (?, ?, ?, ?, ?)",
      renglon,
      mesa,
      huellaDelActa,
      tipo,
      llavePublica,
    ),
  lectura: (renglon, { mesa, momento, modelo, estado }) =>
    sentencia("INSERT INTO lecturas_ia (renglon, mesa, momento, modelo, estado) VALUES (?, ?, ?, ?, ?)", renglon, mesa, momento, modelo, estado),
};

export class AlmacenSql {
  constructor(conductor) {
    this.conductor = conductor;
  }

  async consultarUna(sql, ...parametros) {
    const [filas] = await this.conductor.consultar([sentencia(sql, ...parametros)]);
    return filas;
  }

  async consultarPorLlaves(sql, llaves) {
    const resultados = await this.conductor.consultar(llaves.map((llave) => sentencia(sql, llave)));
    return resultados.map((filas) => filas[0] ?? null);
  }

  async ultimoRenglon() {
    const [fila] = await this.consultarUna("SELECT numero, huella FROM cuaderno ORDER BY numero DESC LIMIT 1");
    return fila ? { numero: fila.numero, huella: fila.huella } : null;
  }

  async leerRenglones(desde, limite, hasta = Number.MAX_SAFE_INTEGER) {
    const filas = await this.consultarUna(
      "SELECT numero, tipo, huella_anterior, contenido, huella FROM cuaderno WHERE numero >= ? AND numero <= ? ORDER BY numero LIMIT ?",
      desde,
      hasta,
      limite,
    );
    return filas.map(renglonDesdeFila);
  }

  async leerNodos(posiciones) {
    const resultados = await this.conductor.consultar(
      posiciones.map(({ nivel, indice }) => sentencia("SELECT huella, sumas FROM tablero WHERE nivel = ? AND indice = ?", nivel, indice)),
    );
    return resultados.map((filas) => nodoDesdeFila(filas[0]));
  }

  async leerActa(mesa) {
    const [fila] = await this.consultarUna("SELECT mesa, casillero, huella_acta, renglon, foto_sha256 FROM actas WHERE mesa = ?", mesa);
    return fila ?? null;
  }

  async mesasConFoto(fotoSha256) {
    const filas = await this.consultarUna("SELECT mesa FROM actas WHERE foto_sha256 = ?", fotoSha256);
    return filas.map((fila) => fila.mesa);
  }

  async listarMesas() {
    const filas = await this.consultarUna("SELECT mesa FROM actas ORDER BY mesa");
    return filas.map((fila) => fila.mesa);
  }

  async leerReciboPorHuella(huellaActa) {
    const [fila] = await this.consultarUna("SELECT documento FROM recibos WHERE huella_acta = ?", huellaActa);
    return fila ? JSON.parse(fila.documento) : null;
  }

  async leerRecibo(renglon) {
    const [fila] = await this.consultarUna("SELECT documento FROM recibos WHERE renglon = ?", renglon);
    return fila ? JSON.parse(fila.documento) : null;
  }

  async leerPadron(llavesPublicas) {
    return this.consultarPorLlaves("SELECT llave_publica, rol, mesa, partido, renglon FROM padron WHERE llave_publica = ?", llavesPublicas);
  }

  async leerAutoridades(llavesPublicas) {
    return this.consultarPorLlaves("SELECT llave_publica, nombre, renglon FROM autoridades WHERE llave_publica = ?", llavesPublicas);
  }

  async leerReemplazos(llavesPublicas) {
    return this.consultarPorLlaves("SELECT llave_vieja, llave_nueva, renglon FROM reemplazos WHERE llave_vieja = ?", llavesPublicas);
  }

  async leerOpiniones(mesa) {
    return this.consultarUna("SELECT renglon, mesa, huella_acta, tipo, llave_publica FROM opiniones WHERE mesa = ? ORDER BY renglon", mesa);
  }

  async leerLecturas(mesa) {
    return this.consultarUna("SELECT renglon, mesa, momento, modelo, estado FROM lecturas_ia WHERE mesa = ? ORDER BY renglon", mesa);
  }

  async contarLecturas(mesa) {
    const [fila] = await this.consultarUna("SELECT COUNT(*) AS cantidad FROM lecturas_ia WHERE mesa = ?", mesa);
    return fila.cantidad;
  }

  async ultimaRaiz() {
    const [fila] = await this.consultarUna("SELECT documento FROM raices ORDER BY numero DESC LIMIT 1");
    return fila ? JSON.parse(fila.documento) : null;
  }

  async leerRaices(desde, limite) {
    const filas = await this.consultarUna("SELECT documento FROM raices WHERE numero >= ? ORDER BY numero LIMIT ?", desde, limite);
    return filas.map((fila) => JSON.parse(fila.documento));
  }

  async leerActaConCamino(mesa, posiciones) {
    const resultados = await this.conductor.consultar([
      sentencia("SELECT mesa, casillero, huella_acta, renglon, foto_sha256 FROM actas WHERE mesa = ?", mesa),
      ...posiciones.map(({ nivel, indice }) =>
        sentencia("SELECT huella, sumas FROM tablero WHERE nivel = ? AND indice = ?", nivel, indice),
      ),
    ]);
    const [filasActa, ...filasNodos] = resultados;
    return { acta: filasActa[0] ?? null, nodos: filasNodos.map((filas) => nodoDesdeFila(filas[0])) };
  }

  async leerFoto(huella) {
    const [fila] = await this.consultarUna("SELECT huella, tipo, tamano, subida_por, fecha FROM fotos WHERE huella = ?", huella);
    return fila ?? null;
  }

  async listarFotos(desdeFecha, limite) {
    return this.consultarUna("SELECT huella, tipo, tamano, fecha FROM fotos WHERE fecha >= ? ORDER BY fecha, huella LIMIT ?", desdeFecha, limite);
  }

  async guardarFoto({ huella, tipo, tamano, subidaPor, fecha }) {
    await this.conductor.escribir([
      sentencia(
        "INSERT INTO fotos (huella, tipo, tamano, subida_por, fecha) VALUES (?, ?, ?, ?, ?) ON CONFLICT (huella) DO NOTHING",
        huella,
        tipo,
        tamano,
        subidaPor,
        fecha,
      ),
    ]);
  }

  // Devuelve false si la petición ya se había usado: la llave primaria impide repetirla.
  async usarPeticion(huella, fecha) {
    const [antes] = await this.consultarUna("SELECT huella FROM peticiones_usadas WHERE huella = ?", huella);
    if (antes) {
      return false;
    }
    try {
      await this.conductor.escribir([sentencia("INSERT INTO peticiones_usadas (huella, fecha) VALUES (?, ?)", huella, fecha)]);
      return true;
    } catch {
      return false;
    }
  }

  async guardarRenglon(renglon, indices = []) {
    await this.conductor.escribir([sentenciaRenglon(renglon), ...indices]);
  }

  async guardarLlegada({ renglon, recibo, acta, nodos }) {
    await this.conductor.escribir([
      sentenciaRenglon(renglon),
      sentencia(
        "INSERT INTO recibos (renglon, huella_acta, documento) VALUES (?, ?, ?)",
        renglon.numero,
        acta.huella_acta,
        JSON.stringify(recibo),
      ),
      sentencia(
        "INSERT INTO actas (mesa, casillero, huella_acta, renglon, foto_sha256) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (mesa) DO UPDATE SET huella_acta = excluded.huella_acta, renglon = excluded.renglon, foto_sha256 = excluded.foto_sha256",
        acta.mesa,
        acta.casillero,
        acta.huella_acta,
        acta.renglon,
        acta.foto_sha256,
      ),
      ...nodos.map((nodo) =>
        sentencia(
          "INSERT INTO tablero (nivel, indice, huella, sumas) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT (nivel, indice) DO UPDATE SET huella = excluded.huella, sumas = excluded.sumas",
          nodo.nivel,
          nodo.indice,
          nodo.huella,
          JSON.stringify(nodo.sumas),
        ),
      ),
    ]);
  }

  async guardarRaices(documentos) {
    await this.conductor.escribir(
      documentos.map((documento) =>
        sentencia(
          "INSERT INTO raices (numero, huella, documento) VALUES (?, ?, ?)",
          documento.contenido.numero,
          documento.huella,
          JSON.stringify(documento),
        ),
      ),
    );
  }
}
