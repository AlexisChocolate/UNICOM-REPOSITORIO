// Almacén de archivos (fotos y volcados): R2 en Cloudflare, una carpeta en el plan B.
// Interfaz: guardar(clave, bytes, tipo), leer(clave) -> {bytes, tipo} | null, existe(clave) -> boolean.

export function archivosR2(cubeta) {
  return {
    async guardar(clave, bytes, tipo) {
      await cubeta.put(clave, bytes, { httpMetadata: { contentType: tipo } });
    },
    async leer(clave) {
      const objeto = await cubeta.get(clave);
      if (!objeto) {
        return null;
      }
      return { bytes: new Uint8Array(await objeto.arrayBuffer()), tipo: objeto.httpMetadata?.contentType ?? "application/octet-stream" };
    },
    async existe(clave) {
      return (await cubeta.head(clave)) !== null;
    },
  };
}

export function archivosEnMemoria() {
  const guardados = new Map();
  return {
    guardados,
    async guardar(clave, bytes, tipo) {
      guardados.set(clave, { bytes: new Uint8Array(bytes), tipo });
    },
    async leer(clave) {
      return guardados.get(clave) ?? null;
    },
    async existe(clave) {
      return guardados.has(clave);
    },
  };
}
