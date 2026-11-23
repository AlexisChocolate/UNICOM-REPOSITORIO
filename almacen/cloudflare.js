import { AlmacenSql } from "./almacen-sql.js";

// D1 aplica un batch() como una sola transacción y lo cuenta como una sola consulta
// (límites de D1: 50 consultas por invocación en el plan gratuito).
export function conductorD1(baseD1) {
  const preparar = ({ sql, parametros }) => baseD1.prepare(sql).bind(...parametros);
  return {
    async consultar(sentencias) {
      const resultados = await baseD1.batch(sentencias.map(preparar));
      return resultados.map((resultado) => resultado.results ?? []);
    },
    async escribir(sentencias) {
      await baseD1.batch(sentencias.map(preparar));
    },
  };
}

export function almacenCloudflare(baseD1) {
  return new AlmacenSql(conductorD1(baseD1));
}
