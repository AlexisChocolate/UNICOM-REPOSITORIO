// Capa de almacén (arquitectura, sec. 1): la ventanilla y la API solo hablan con esta clase.
// Debajo va un conductor de D1 (Cloudflare) o de SQLite local (plan B), con el mismo SQL.
//
// Un conductor expone:
//   consultar(lista de {sql, parametros}) -> lista de filas por consulta, todas de la misma foto de la base
//   escribir(lista de {sql, parametros})  -> aplica todo o nada

function sentencia(sql, ...parametros) {
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

export class AlmacenSql {
  constructor(conductor) {
    this.conductor = conductor;
  }

  async consultarUna(sql, ...parametros) {
    const [filas] = await this.conductor.consultar([sentencia(sql, ...parametros)]);
    return filas;
  }

  async ultimoRenglon() {
    const [fila] = await this.consultarUna("SELECT numero, huella FROM cuaderno ORDER BY numero DESC LIMIT 1");
    return fila ? { numero: fila.numero, huella: fila.huella } : null;
  }

  async leerRenglones(desde, limite) {
    const filas = await this.consultarUna(
      "SELECT numero, tipo, huella_anterior, contenido, huella FROM cuaderno WHERE numero >= ? ORDER BY numero LIMIT ?",
      desde,
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
    const [fila] = await this.consultarUna("SELECT mesa, casillero, huella_acta, renglon FROM actas WHERE mesa = ?", mesa);
    return fila ?? null;
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
    const resultados = await this.conductor.consultar(
      llavesPublicas.map((llave) =>
        sentencia("SELECT llave_publica, rol, mesa, partido, renglon FROM padron WHERE llave_publica = ?", llave),
      ),
    );
    return resultados.map((filas) => filas[0] ?? null);
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
      sentencia("SELECT mesa, casillero, huella_acta, renglon FROM actas WHERE mesa = ?", mesa),
      ...posiciones.map(({ nivel, indice }) =>
        sentencia("SELECT huella, sumas FROM tablero WHERE nivel = ? AND indice = ?", nivel, indice),
      ),
    ]);
    const [filasActa, ...filasNodos] = resultados;
    return { acta: filasActa[0] ?? null, nodos: filasNodos.map((filas) => nodoDesdeFila(filas[0])) };
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
        "INSERT INTO actas (mesa, casillero, huella_acta, renglon) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT (mesa) DO UPDATE SET huella_acta = excluded.huella_acta, renglon = excluded.renglon",
        acta.mesa,
        acta.casillero,
        acta.huella_acta,
        acta.renglon,
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

  async guardarPadron({ renglon, entrada }) {
    await this.conductor.escribir([
      sentenciaRenglon(renglon),
      sentencia(
        "INSERT INTO padron (llave_publica, rol, mesa, partido, renglon) VALUES (?, ?, ?, ?, ?)",
        entrada.llave_publica,
        entrada.rol,
        entrada.mesa,
        entrada.partido,
        renglon.numero,
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
