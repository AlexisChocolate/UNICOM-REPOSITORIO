// Subconjunto de RFC 8785: claves ordenadas, sin espacios, solo enteros seguros y texto ASCII.
// RFC 8785 no normaliza Unicode (sec. 3.1), por eso se rechaza todo lo que no sea ASCII:
// dos textos que se ven iguales nunca pueden dar huellas distintas.
const PATRON_ASCII = /^[\x20-\x7e]*$/;

export function canonico(valor) {
  if (valor === null) {
    return "null";
  }
  if (typeof valor === "boolean") {
    return valor ? "true" : "false";
  }
  if (typeof valor === "number") {
    if (!Number.isSafeInteger(valor)) {
      throw new Error(`JSON canónico: solo se aceptan enteros seguros, no ${valor}`);
    }
    return String(valor);
  }
  if (typeof valor === "string") {
    if (!PATRON_ASCII.test(valor)) {
      throw new Error(`JSON canónico: solo se acepta texto ASCII imprimible: ${JSON.stringify(valor)}`);
    }
    return JSON.stringify(valor);
  }
  if (Array.isArray(valor)) {
    return "[" + valor.map(canonico).join(",") + "]";
  }
  if (typeof valor === "object") {
    const claves = Object.keys(valor).sort();
    const partes = [];
    for (const clave of claves) {
      if (valor[clave] === undefined) {
        throw new Error(`JSON canónico: la clave "${clave}" no tiene valor`);
      }
      partes.push(canonico(clave) + ":" + canonico(valor[clave]));
    }
    return "{" + partes.join(",") + "}";
  }
  throw new Error(`JSON canónico: tipo no permitido (${typeof valor})`);
}
