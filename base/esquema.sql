-- Esquema de UNICOM. Lo usan D1 (Cloudflare) y SQLite local (plan B) sin cambios.
-- Solo escribe la ventanilla única. Los triggers protegen contra errores del programa,
-- no contra el dueño de la cuenta (arquitectura, sec. 5.7).

CREATE TABLE IF NOT EXISTS cuaderno (
  numero INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,
  huella_anterior TEXT NOT NULL,
  contenido TEXT NOT NULL,
  huella TEXT NOT NULL UNIQUE
);

CREATE TRIGGER IF NOT EXISTS cuaderno_sin_cambios BEFORE UPDATE ON cuaderno
BEGIN
  SELECT RAISE(ABORT, 'cuaderno: solo se agrega');
END;

CREATE TRIGGER IF NOT EXISTS cuaderno_sin_borrados BEFORE DELETE ON cuaderno
BEGIN
  SELECT RAISE(ABORT, 'cuaderno: solo se agrega');
END;

CREATE TABLE IF NOT EXISTS padron (
  llave_publica TEXT PRIMARY KEY,
  rol TEXT NOT NULL,
  mesa TEXT,
  partido TEXT,
  renglon INTEGER NOT NULL REFERENCES cuaderno(numero)
);

CREATE TRIGGER IF NOT EXISTS padron_sin_cambios BEFORE UPDATE ON padron
BEGIN
  SELECT RAISE(ABORT, 'padron: solo se agrega');
END;

CREATE TRIGGER IF NOT EXISTS padron_sin_borrados BEFORE DELETE ON padron
BEGIN
  SELECT RAISE(ABORT, 'padron: solo se agrega');
END;

CREATE TABLE IF NOT EXISTS recibos (
  renglon INTEGER PRIMARY KEY REFERENCES cuaderno(numero),
  huella_acta TEXT NOT NULL UNIQUE,
  documento TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS recibos_sin_cambios BEFORE UPDATE ON recibos
BEGIN
  SELECT RAISE(ABORT, 'recibos: solo se agrega');
END;

CREATE TRIGGER IF NOT EXISTS recibos_sin_borrados BEFORE DELETE ON recibos
BEGIN
  SELECT RAISE(ABORT, 'recibos: solo se agrega');
END;

-- Índice de la tabla hash Mesas: n.º de mesa -> casillero -> acta vigente. Cambia cuando se corrige un acta.
CREATE TABLE IF NOT EXISTS actas (
  mesa TEXT PRIMARY KEY,
  casillero INTEGER NOT NULL UNIQUE,
  huella_acta TEXT NOT NULL,
  renglon INTEGER NOT NULL REFERENCES cuaderno(numero)
);

-- Solo los nodos no vacíos del árbol; se puede recalcular entero desde el cuaderno.
CREATE TABLE IF NOT EXISTS tablero (
  nivel INTEGER NOT NULL,
  indice INTEGER NOT NULL,
  huella TEXT NOT NULL,
  sumas TEXT NOT NULL,
  PRIMARY KEY (nivel, indice)
);

CREATE TABLE IF NOT EXISTS raices (
  numero INTEGER PRIMARY KEY,
  huella TEXT NOT NULL UNIQUE,
  documento TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS raices_sin_cambios BEFORE UPDATE ON raices
BEGIN
  SELECT RAISE(ABORT, 'raices: solo se agrega');
END;

CREATE TRIGGER IF NOT EXISTS raices_sin_borrados BEFORE DELETE ON raices
BEGIN
  SELECT RAISE(ABORT, 'raices: solo se agrega');
END;
