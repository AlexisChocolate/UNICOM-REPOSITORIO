import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { AlmacenSql } from "./almacen-sql.js";

const RUTA_ESQUEMA = new URL("../base/esquema.sql", import.meta.url);

export function conductorSqliteLocal(base) {
  return {
    async consultar(sentencias) {
      return sentencias.map(({ sql, parametros }) => base.prepare(sql).all(...parametros));
    },
    async escribir(sentencias) {
      base.exec("BEGIN");
      try {
        for (const { sql, parametros } of sentencias) {
          base.prepare(sql).run(...parametros);
        }
        base.exec("COMMIT");
      } catch (error) {
        base.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

// Plan B sin internet (arquitectura, sec. 9): SQLite en un archivo de la laptop, mismo esquema y mismo SQL.
export function almacenLocal(rutaArchivo = ":memory:") {
  const base = new DatabaseSync(rutaArchivo);
  base.exec(readFileSync(RUTA_ESQUEMA, "utf8"));
  const almacen = new AlmacenSql(conductorSqliteLocal(base));
  almacen.base = base;
  return almacen;
}
