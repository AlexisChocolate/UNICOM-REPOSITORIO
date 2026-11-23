// De dónde lee el auditor: la API pública (lo normal) o una base local (plan B y simulación de ataques).
// El auditor nunca escribe en la fuente.

export function fuenteHttp(direccion) {
  const base = direccion.replace(/\/+$/, "");
  async function pedirJson(ruta) {
    const respuesta = await fetch(base + ruta);
    if (respuesta.status === 404) {
      return null;
    }
    if (!respuesta.ok) {
      throw new Error(`${ruta} respondió ${respuesta.status}`);
    }
    return respuesta.json();
  }
  return {
    descripcion: base,
    async cuaderno() {
      const renglones = [];
      for (;;) {
        const pagina = await pedirJson(`/cuaderno?desde=${renglones.length + 1}&limite=500`);
        renglones.push(...pagina.renglones);
        if (pagina.renglones.length < 500) {
          return renglones;
        }
      }
    },
    async raices() {
      const raices = [];
      for (;;) {
        const pagina = await pedirJson(`/raices?desde=${raices.length}&limite=500`);
        raices.push(...pagina.raices);
        if (pagina.raices.length < 500) {
          return raices;
        }
      }
    },
    async recibo(renglon) {
      return pedirJson(`/recibos/${renglon}`);
    },
    async foto(huella) {
      const respuesta = await fetch(`${base}/fotos/${huella}`);
      return respuesta.ok ? new Uint8Array(await respuesta.arrayBuffer()) : null;
    },
    async tablero() {
      return pedirJson("/tablero");
    },
  };
}

export function fuenteLocal({ almacen, archivos = null }) {
  return {
    descripcion: "base local",
    async cuaderno() {
      return almacen.leerRenglones(1, Number.MAX_SAFE_INTEGER);
    },
    async raices() {
      return almacen.leerRaices(0, Number.MAX_SAFE_INTEGER);
    },
    async recibo(renglon) {
      return almacen.leerRecibo(renglon);
    },
    async foto(huella) {
      const archivo = archivos ? await archivos.leer(`fotos/${huella}`) : null;
      return archivo ? archivo.bytes : null;
    },
    async tablero() {
      const [nodo] = await almacen.leerNodos([{ nivel: 17, indice: 0 }]);
      return nodo ? { raiz_tablero: nodo.huella } : null;
    },
  };
}
