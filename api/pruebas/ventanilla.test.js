import { test } from "node:test";
import assert from "node:assert/strict";
import { almacenLocal } from "../../almacen/local.js";
import {
  firmarHuella,
  generarLlaveNoExportable,
  huellaActa,
  llavePublicaHex,
  verificarCadenaRaices,
  verificarCuaderno,
  verificarDocumento,
  verificarInclusion,
  huellaHex,
} from "../../nucleo/index.js";
import { ErrorUnicom, Ventanilla } from "../ventanilla.js";
import { estadoTablero, pruebaDeMesa } from "../lecturas.js";

async function nuevaLlave() {
  const llaves = await generarLlaveNoExportable();
  return { privada: llaves.privateKey, publica: await llavePublicaHex(llaves.publicKey) };
}

async function prepararEscenario() {
  const almacen = almacenLocal();
  const servidor = await nuevaLlave();
  const ventanilla = new Ventanilla({
    almacen,
    llavePrivada: servidor.privada,
    llavePublica: servidor.publica,
    reloj: () => new Date("2026-11-27T21:30:00.000Z"),
  });
  const rosa = await nuevaLlave();
  const personeroSol = await nuevaLlave();
  await ventanilla.registrarEnPadron({ rol: "miembro", mesa: "045123", llave_publica: rosa.publica });
  await ventanilla.registrarEnPadron({ rol: "personero", partido: "P01", llave_publica: personeroSol.publica });
  return { almacen, ventanilla, servidor, rosa, personeroSol };
}

async function paqueteDeJuliaca(cambios = {}) {
  return {
    mesa: "045123",
    votos: { P01: 120, P02: 80, blancos: 6, nulos: 4, impugnados: 1 },
    foto_sha256: await huellaHex(new TextEncoder().encode("foto del acta 045123")),
    precinto_sha256: null,
    precinto_numero: null,
    fecha_hora_declarada: "2026-11-27T16:05:00-05:00",
    personeros_presentes: false,
    reemplaza_a: null,
    ...cambios,
  };
}

async function firmar(paquete, ...firmantes) {
  const huellaDelActa = await huellaActa(paquete);
  const firmas = [];
  for (const { rol, llave } of firmantes) {
    firmas.push({ rol, llave_publica: llave.publica, firma: await firmarHuella(llave.privada, huellaDelActa) });
  }
  return { paquete, firmas };
}

test("Rosa envía el acta 045123 firmada y recibe un recibo firmado por el servidor", async () => {
  const { ventanilla, servidor, rosa } = await prepararEscenario();
  const paquete = await paqueteDeJuliaca();
  const resultado = await ventanilla.recibirActa(await firmar(paquete, { rol: "miembro", llave: rosa }));
  assert.equal(resultado.repetida, false);
  assert.equal(await verificarDocumento(resultado.recibo, servidor.publica), true);
  assert.equal(resultado.recibo.contenido.huella_acta, await huellaActa(paquete));
  assert.equal(resultado.recibo.contenido.renglon, 3);
  assert.equal(resultado.recibo.contenido.hora_llegada, "2026-11-27T21:30:00.000Z");
});

test("el acta queda en el tablero y su prueba de inclusión llega a la raíz", async () => {
  const { almacen, ventanilla, rosa } = await prepararEscenario();
  await ventanilla.recibirActa(await firmar(await paqueteDeJuliaca(), { rol: "miembro", llave: rosa }));
  const prueba = await pruebaDeMesa(almacen, "045123");
  assert.equal(prueba.casillero, 45123);
  assert.deepEqual(prueba.sumas, [120, 80, 6, 4, 1]);
  assert.equal(
    await verificarInclusion({
      casillero: prueba.casillero,
      huellaActa: prueba.huella_acta,
      sumas: prueba.sumas,
      hermanos: prueba.hermanos,
      raiz: prueba.raiz,
    }),
    true,
  );
  const tablero = await estadoTablero(almacen);
  assert.deepEqual(tablero.totales, { P01: 120, P02: 80, blancos: 6, nulos: 4, impugnados: 1 });
  assert.equal(tablero.raiz_tablero, prueba.raiz.huella);
});

test("con cofirma de un personero también se acepta", async () => {
  const { ventanilla, rosa, personeroSol } = await prepararEscenario();
  const paquete = await paqueteDeJuliaca({ personeros_presentes: true });
  const resultado = await ventanilla.recibirActa(
    await firmar(paquete, { rol: "miembro", llave: rosa }, { rol: "personero", llave: personeroSol }),
  );
  assert.equal(resultado.repetida, false);
});

test("reenviar la misma acta devuelve el mismo recibo sin anotarla dos veces", async () => {
  const { almacen, ventanilla, rosa } = await prepararEscenario();
  const cuerpo = await firmar(await paqueteDeJuliaca(), { rol: "miembro", llave: rosa });
  const primero = await ventanilla.recibirActa(cuerpo);
  const segundo = await ventanilla.recibirActa(cuerpo);
  assert.equal(segundo.repetida, true);
  assert.deepEqual(segundo.recibo, primero.recibo);
  assert.equal((await almacen.ultimoRenglon()).numero, 3);
});

test("una firma que no corresponde al paquete se rechaza", async () => {
  const { ventanilla, rosa } = await prepararEscenario();
  const cuerpo = await firmar(await paqueteDeJuliaca(), { rol: "miembro", llave: rosa });
  cuerpo.paquete.votos.P01 = 150;
  await assert.rejects(ventanilla.recibirActa(cuerpo), (error) => error instanceof ErrorUnicom && error.codigo === "firma_invalida");
});

test("un firmante que no está en el padrón se rechaza", async () => {
  const { ventanilla } = await prepararEscenario();
  const intruso = await nuevaLlave();
  const cuerpo = await firmar(await paqueteDeJuliaca(), { rol: "miembro", llave: intruso });
  await assert.rejects(ventanilla.recibirActa(cuerpo), (error) => error.codigo === "firmante_no_registrado");
});

test("un miembro de otra mesa no puede firmar el acta 045123", async () => {
  const { ventanilla } = await prepararEscenario();
  const miembroDeOtraMesa = await nuevaLlave();
  await ventanilla.registrarEnPadron({ rol: "miembro", mesa: "045124", llave_publica: miembroDeOtraMesa.publica });
  const cuerpo = await firmar(await paqueteDeJuliaca(), { rol: "miembro", llave: miembroDeOtraMesa });
  await assert.rejects(ventanilla.recibirActa(cuerpo), (error) => error.codigo === "firmante_no_registrado");
});

test("solo con la firma de un personero no basta", async () => {
  const { ventanilla, personeroSol } = await prepararEscenario();
  const cuerpo = await firmar(await paqueteDeJuliaca(), { rol: "personero", llave: personeroSol });
  await assert.rejects(ventanilla.recibirActa(cuerpo), (error) => error.codigo === "firma_invalida");
});

test("una segunda acta distinta para la misma mesa se rechaza si no dice a cuál reemplaza", async () => {
  const { ventanilla, rosa } = await prepararEscenario();
  await ventanilla.recibirActa(await firmar(await paqueteDeJuliaca(), { rol: "miembro", llave: rosa }));
  const otra = await firmar(await paqueteDeJuliaca({ votos: { P01: 121, P02: 80, blancos: 6, nulos: 4, impugnados: 1 } }), {
    rol: "miembro",
    llave: rosa,
  });
  await assert.rejects(ventanilla.recibirActa(otra), (error) => error.codigo === "mesa_ya_registrada");
});

test("una corrección con reemplaza_a actualiza el tablero y deja las dos en el cuaderno", async () => {
  const { almacen, ventanilla, rosa } = await prepararEscenario();
  const original = await paqueteDeJuliaca();
  await ventanilla.recibirActa(await firmar(original, { rol: "miembro", llave: rosa }));
  const correccion = await paqueteDeJuliaca({
    votos: { P01: 121, P02: 80, blancos: 5, nulos: 4, impugnados: 1 },
    reemplaza_a: await huellaActa(original),
  });
  await ventanilla.recibirActa(await firmar(correccion, { rol: "miembro", llave: rosa }));
  const tablero = await estadoTablero(almacen);
  assert.equal(tablero.totales.P01, 121);
  assert.equal(tablero.ultimo_renglon.numero, 4);
});

test("un paquete mal formado se rechaza con la lista de problemas", async () => {
  const { ventanilla, rosa } = await prepararEscenario();
  const paquete = await paqueteDeJuliaca({ votos: { P01: -1, P02: 80 }, extra: "no" });
  await assert.rejects(ventanilla.recibirActa(await firmar(paquete, { rol: "miembro", llave: rosa })), (error) => {
    assert.equal(error.codigo, "paquete_invalido");
    assert.ok(error.detalles.length >= 3);
    return true;
  });
});

test("diez actas que llegan a la vez quedan en un solo cuaderno, sin ramas", async () => {
  const { almacen, ventanilla } = await prepararEscenario();
  const envios = [];
  for (let numero = 0; numero < 10; numero++) {
    const mesa = String(45200 + numero).padStart(6, "0");
    const miembro = await nuevaLlave();
    await ventanilla.registrarEnPadron({ rol: "miembro", mesa, llave_publica: miembro.publica });
    const votos = { P01: 100 + numero, P02: 90, blancos: 3, nulos: 2, impugnados: 0 };
    envios.push(firmar(await paqueteDeJuliaca({ mesa, votos }), { rol: "miembro", llave: miembro }));
  }
  const cuerpos = await Promise.all(envios);
  await Promise.all(cuerpos.map((cuerpo) => ventanilla.recibirActa(cuerpo)));
  const renglones = await almacen.leerRenglones(1, 100);
  assert.equal(renglones.length, 2 + 10 + 10);
  assert.equal((await verificarCuaderno(renglones)).valido, true);
  const tablero = await estadoTablero(almacen);
  assert.equal(tablero.totales.P01, 1045);
});

test("la base rechaza cambiar o borrar renglones del cuaderno", async () => {
  const { almacen } = await prepararEscenario();
  assert.throws(() => almacen.base.exec("UPDATE cuaderno SET tipo = 'acta' WHERE numero = 1"), /solo se agrega/);
  assert.throws(() => almacen.base.exec("DELETE FROM cuaderno WHERE numero = 1"), /solo se agrega/);
});

test("publicar raíces crea la génesis y una cadena que se verifica con la llave del servidor", async () => {
  const { ventanilla, servidor, rosa } = await prepararEscenario();
  const primera = await ventanilla.publicarRaiz();
  assert.equal(primera.publicadas.length, 2);
  await ventanilla.recibirActa(await firmar(await paqueteDeJuliaca(), { rol: "miembro", llave: rosa }));
  const segunda = await ventanilla.publicarRaiz();
  assert.equal(segunda.publicadas.length, 1);
  const cadena = [...primera.publicadas, ...segunda.publicadas];
  const resultado = await verificarCadenaRaices(cadena, servidor.publica);
  assert.equal(resultado.valida, true);
  assert.equal(resultado.ultima.contenido.totales.P01, 120);
  assert.equal(resultado.ultima.contenido.renglones, 3);
});

test("el padrón no acepta la misma llave dos veces", async () => {
  const { ventanilla, rosa } = await prepararEscenario();
  await assert.rejects(
    ventanilla.registrarEnPadron({ rol: "miembro", mesa: "045123", llave_publica: rosa.publica }),
    (error) => error.codigo === "llave_ya_registrada",
  );
});
