import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";

const TIPOS_POR_EXTENSION = { ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

// Plan B sin internet (arquitectura, sec. 9): los mismos archivos que irían a R2, en una carpeta de la laptop.
export function archivosEnCarpeta(carpeta) {
  const ruta = (clave) => join(carpeta, ...clave.split("/"));
  return {
    async guardar(clave, bytes) {
      await mkdir(dirname(ruta(clave)), { recursive: true });
      await writeFile(ruta(clave), bytes);
    },
    async leer(clave) {
      try {
        const bytes = new Uint8Array(await readFile(ruta(clave)));
        const extension = clave.slice(clave.lastIndexOf("."));
        return { bytes, tipo: TIPOS_POR_EXTENSION[extension] ?? "application/octet-stream" };
      } catch {
        return null;
      }
    },
    async existe(clave) {
      try {
        await access(ruta(clave));
        return true;
      } catch {
        return false;
      }
    },
  };
}
