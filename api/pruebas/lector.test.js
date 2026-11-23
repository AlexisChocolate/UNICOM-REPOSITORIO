import { test } from "node:test";
import assert from "node:assert/strict";
import { almacenLocal } from "../../almacen/local.js";
import { contenidoPeticionLectura, contrastar, firmarHuella, firmarObjeto, generarLlaveNoExportable, huellaDeObjeto, huellaHex, llavePublicaHex, reconstruirEstado } from "../../nucleo/index.js";
import { Ventanilla } from "../ventanilla.js";
import { LECTURAS_POR_MESA, MODELO_LECTOR, atenderLectura } from "../lector.js";

const AHORA = new Date("2026-11-27T21:30:00.000Z");
const IMAGEN = new TextEncoder().encode("foto reducida del acta 045123");

async function nuevaLlave() {
  const llaves = await generarLlaveNoExportable();
  return { privada: llaves.privateKey, publica: await llavePublicaHex(llaves.publicKey) };
}

async function preparar() {
  const almacen = almacenLocal();
  const servidor = await nuevaLlave();
  const ventanilla = new Ventanilla({ almacen, llaves: [{ llavePrivada: servidor.privada, llavePublica: servidor.publica }], reloj: () => AHORA });
  const rosa = await nuevaLlave();
  await ventanilla.registrarEnPadron({ rol: "miembro", mesa: "045123", llave_publica: rosa.publica }, { comoAdministrador: true });
  return { almacen, ventanilla, rosa };
}

async function peticion(rosa, cambios = {}) {
  const base = {
    mesa: "045123",
    momento: "antes_del_sello",
    fecha: AHORA.toISOString(),
    huella_foto: await huellaHex(new TextEncoder().encode("foto original del acta 045123")),
    huella_imagen_enviada: await huellaHex(IMAGEN),
    tipo_imagen: "image/jpeg",
    imagen_base64: btoa(String.fromCharCode(...IMAGEN)),
    llave_publica: rosa.publica,
    ...cambios,
  };
  return { ...base, firma: await firmarHuella(rosa.privada, await huellaDeObjeto(contenidoPeticionLectura(base))) };
}

function claudeSimulado(respuesta) {
  const llamadas = [];
  return {
    llamadas,
    messages: {
      async create(parametros) {
        llamadas.push(parametros);
        if (respuesta instanceof Error) {
          throw respuesta;
        }
        return respuesta;
      },
    },
  };
}

const LECTURA_CORRECTA = {
  P01: { legible: true, valor: 120, confianza: 0.97, tachon: false },
  P02: { legible: true, valor: 80, confianza: 0.95, tachon: false },
  blancos: { legible: true, valor: 6, confianza: 0.9, tachon: false },
  nulos: { legible: true, valor: 5, confianza: 0.88, tachon: false },
  impugnados: { legible: false, valor: 0, confianza: 0.2, tachon: true },
};

test("Claude lee el acta, la lectura queda en el cuaderno y la web puede contrastarla", async () => {
  const { almacen, ventanilla, rosa } = await preparar();
  const cliente = claudeSimulado({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(LECTURA_CORRECTA) }] });
  const resultado = await atenderLectura({ cuerpo: await peticion(rosa), almacen, ventanilla, cliente, ahora: AHORA });
  assert.equal(resultado.estado, "leida");
  assert.equal(resultado.modelo, MODELO_LECTOR);
  assert.equal(cliente.llamadas[0].model, "claude-fable-5-2");
  assert.equal(cliente.llamadas[0].output_config.format.type, "json_schema");
  assert.equal(resultado.lectura.impugnados.valor, null);
  const contraste = contrastar(resultado.lectura, { P01: 120, P02: 80, blancos: 6, nulos: 4, impugnados: 1 });
  assert.equal(contraste.campos.nulos.color, "rojo");
  assert.equal(contraste.campos.impugnados.color, "amarillo");
  const [renglon] = await almacen.leerRenglones(resultado.renglon, 1);
  assert.equal(renglon.tipo, "lectura_ia");
  assert.equal(renglon.contenido.resultado.P01.confianza_milesimas, 970);
});

test("sin clave de Claude configurada: lectura pendiente, sin otra IA", async () => {
  const { almacen, ventanilla, rosa } = await preparar();
  const resultado = await atenderLectura({ cuerpo: await peticion(rosa), almacen, ventanilla, cliente: null, ahora: AHORA });
  assert.equal(resultado.estado, "lectura_pendiente");
  assert.equal(resultado.motivo, "lector_no_configurado");
});

test("si Claude no responde o se niega: lectura pendiente", async () => {
  const { almacen, ventanilla, rosa } = await preparar();
  const caido = await atenderLectura({ cuerpo: await peticion(rosa), almacen, ventanilla, cliente: claudeSimulado(new Error("sin red")), ahora: AHORA });
  assert.equal(caido.motivo, "sin_conexion_con_el_lector");
  const negado = await atenderLectura({
    cuerpo: await peticion(rosa, { momento: "despues_del_sello" }),
    almacen,
    ventanilla,
    cliente: claudeSimulado({ stop_reason: "refusal", content: [] }),
    ahora: AHORA,
  });
  assert.equal(negado.motivo, "lector_se_nego");
});

test("candado: una petición firmada no se puede repetir", async () => {
  const { almacen, ventanilla, rosa } = await preparar();
  const cuerpo = await peticion(rosa);
  await atenderLectura({ cuerpo, almacen, ventanilla, cliente: null, ahora: AHORA });
  await assert.rejects(atenderLectura({ cuerpo, almacen, ventanilla, cliente: null, ahora: AHORA }), (error) => error.codigo === "peticion_repetida");
});

test("candado: alguien fuera del padrón no puede gastar lecturas", async () => {
  const { almacen, ventanilla } = await preparar();
  const intruso = await nuevaLlave();
  await assert.rejects(
    atenderLectura({ cuerpo: await peticion(intruso), almacen, ventanilla, cliente: claudeSimulado({}), ahora: AHORA }),
    (error) => error.codigo === "firmante_no_registrado",
  );
});

test("candado: una petición vieja se rechaza", async () => {
  const { almacen, ventanilla, rosa } = await preparar();
  const vieja = await peticion(rosa, { fecha: "2026-11-27T21:00:00.000Z" });
  await assert.rejects(atenderLectura({ cuerpo: vieja, almacen, ventanilla, cliente: null, ahora: AHORA }), (error) => error.codigo === "peticion_vencida");
});

test("candado: una imagen cambiada después de firmar se rechaza", async () => {
  const { almacen, ventanilla, rosa } = await preparar();
  const cuerpo = await peticion(rosa);
  cuerpo.imagen_base64 = btoa("otra imagen");
  await assert.rejects(atenderLectura({ cuerpo, almacen, ventanilla, cliente: null, ahora: AHORA }), (error) => error.codigo === "imagen_no_coincide");
});

test(`candado: después de ${LECTURAS_POR_MESA} lecturas la mesa queda en lectura pendiente`, async () => {
  const { almacen, ventanilla, rosa } = await preparar();
  const cliente = claudeSimulado({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(LECTURA_CORRECTA) }] });
  for (let vez = 0; vez < LECTURAS_POR_MESA; vez++) {
    const resultado = await atenderLectura({ cuerpo: await peticion(rosa, { fecha: new Date(AHORA.getTime() - vez * 1000).toISOString() }), almacen, ventanilla, cliente, ahora: AHORA });
    assert.equal(resultado.estado, "leida");
  }
  const sexta = await atenderLectura({ cuerpo: await peticion(rosa, { fecha: new Date(AHORA.getTime() - 9000).toISOString() }), almacen, ventanilla, cliente, ahora: AHORA });
  assert.equal(sexta.motivo, "limite_de_lecturas_de_la_mesa");
  assert.equal(cliente.llamadas.length, LECTURAS_POR_MESA);
});

test("Rosa anota su decisión ante la lectura y queda firmada en el cuaderno", async () => {
  const { almacen, ventanilla, rosa } = await preparar();
  const resultado = await atenderLectura({ cuerpo: await peticion(rosa), almacen, ventanilla, cliente: null, ahora: AHORA });
  const decision = await ventanilla.registrarDecision(
    await firmarObjeto(rosa.privada, rosa.publica, { decision: "mantuvo_lo_digitado", renglon_lectura: resultado.renglon }),
  );
  const estado = await reconstruirEstado(await almacen.leerRenglones(1, 100));
  assert.deepEqual(estado.problemas, []);
  assert.equal(estado.decisiones[0].decision, "mantuvo_lo_digitado");
  assert.equal(decision.renglon, resultado.renglon + 1);
});
