-- Migración 0002: lleva una base creada con la versión 0.1.0 a la 0.2.0.
-- Se aplica una sola vez: ALTER TABLE falla si la columna ya existe.

ALTER TABLE actas ADD COLUMN foto_sha256 TEXT;

CREATE INDEX IF NOT EXISTS actas_por_foto ON actas (foto_sha256);

CREATE TABLE IF NOT EXISTS autoridades (
  llave_publica TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  renglon INTEGER NOT NULL REFERENCES cuaderno(numero)
);

CREATE TRIGGER IF NOT EXISTS autoridades_sin_cambios BEFORE UPDATE ON autoridades
BEGIN
  SELECT RAISE(ABORT, 'autoridades: solo se agrega');
END;

CREATE TRIGGER IF NOT EXISTS autoridades_sin_borrados BEFORE DELETE ON autoridades
BEGIN
  SELECT RAISE(ABORT, 'autoridades: solo se agrega');
END;

-- Reemplazo de la llave de un miembro de mesa (arquitectura, sec. 5.2): la vieja deja de firmar desde aquí.
CREATE TABLE IF NOT EXISTS reemplazos (
  llave_vieja TEXT PRIMARY KEY,
  llave_nueva TEXT NOT NULL UNIQUE,
  renglon INTEGER NOT NULL REFERENCES cuaderno(numero)
);

CREATE TRIGGER IF NOT EXISTS reemplazos_sin_cambios BEFORE UPDATE ON reemplazos
BEGIN
  SELECT RAISE(ABORT, 'reemplazos: solo se agrega');
END;

CREATE TRIGGER IF NOT EXISTS reemplazos_sin_borrados BEFORE DELETE ON reemplazos
BEGIN
  SELECT RAISE(ABORT, 'reemplazos: solo se agrega');
END;

-- Tabla hash Fotos: huella -> dónde está guardada. El nombre del archivo en R2 es la huella.
CREATE TABLE IF NOT EXISTS fotos (
  huella TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  tamano INTEGER NOT NULL,
  subida_por TEXT NOT NULL,
  fecha TEXT NOT NULL,
  cid_ipfs TEXT
);

CREATE TABLE IF NOT EXISTS opiniones (
  renglon INTEGER PRIMARY KEY REFERENCES cuaderno(numero),
  mesa TEXT NOT NULL,
  huella_acta TEXT NOT NULL,
  tipo TEXT NOT NULL,
  llave_publica TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS opiniones_por_mesa ON opiniones (mesa);

-- Lecturas del lector de IA: sirven de registro y para el límite por mesa (arquitectura, sec. 5.4).
CREATE TABLE IF NOT EXISTS lecturas_ia (
  renglon INTEGER PRIMARY KEY REFERENCES cuaderno(numero),
  mesa TEXT NOT NULL,
  momento TEXT NOT NULL,
  modelo TEXT NOT NULL,
  estado TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS lecturas_por_mesa ON lecturas_ia (mesa);

-- Llaves usadas para pedir lecturas: impide repetir una petición firmada vieja.
CREATE TABLE IF NOT EXISTS peticiones_usadas (
  huella TEXT PRIMARY KEY,
  fecha TEXT NOT NULL
);
