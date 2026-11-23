import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesAHex, concatenar, hexABytes } from "../bytes.js";
import {
  firmarConWebCrypto,
  firmarDocumento,
  generarLlaveNoExportable,
  llavePublicaHex,
  verificarDocumento,
  verificarFirma,
} from "../firmas.js";

// RFC 8032, sec. 7.1, TEST 1, TEST 2 y TEST 3.
const VECTORES_RFC8032 = [
  {
    nombre: "TEST 1 (mensaje vacío)",
    secreta: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    publica: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    mensaje: "",
    firma:
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  },
  {
    nombre: "TEST 2 (un byte)",
    secreta: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    publica: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    mensaje: "72",
    firma:
      "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
  },
  {
    nombre: "TEST 3 (dos bytes)",
    secreta: "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
    publica: "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
    mensaje: "af82",
    firma:
      "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
  },
];

// Encabezado PKCS#8 de una llave privada Ed25519 (RFC 8410, sec. 7) para importar la semilla en Web Crypto.
const ENCABEZADO_PKCS8 = hexABytes("302e020100300506032b657004220420");

async function importarSemilla(secretaHex) {
  return crypto.subtle.importKey("pkcs8", concatenar(ENCABEZADO_PKCS8, hexABytes(secretaHex)), { name: "Ed25519" }, false, [
    "sign",
  ]);
}

for (const vector of VECTORES_RFC8032) {
  test(`RFC 8032 ${vector.nombre}: @noble/curves acepta la firma oficial`, () => {
    assert.equal(verificarFirma(vector.firma, hexABytes(vector.mensaje), vector.publica), true);
    assert.equal(bytesAHex(ed25519.getPublicKey(hexABytes(vector.secreta))), vector.publica);
  });

  test(`RFC 8032 ${vector.nombre}: Web Crypto firma exactamente igual`, async () => {
    const llave = await importarSemilla(vector.secreta);
    assert.equal(await firmarConWebCrypto(llave, hexABytes(vector.mensaje)), vector.firma);
  });

  test(`RFC 8032 ${vector.nombre}: un bit cambiado invalida la firma`, () => {
    const firmaAlterada = hexABytes(vector.firma);
    firmaAlterada[0] ^= 1;
    assert.equal(verificarFirma(bytesAHex(firmaAlterada), hexABytes(vector.mensaje), vector.publica), false);
  });
}

test("una llave no exportable de Web Crypto no se puede sacar del navegador", async () => {
  const llaves = await generarLlaveNoExportable();
  await assert.rejects(crypto.subtle.exportKey("jwk", llaves.privateKey));
  assert.match(await llavePublicaHex(llaves.publicKey), /^[0-9a-f]{64}$/);
});

test("firma de Rosa hecha con Web Crypto se verifica con @noble/curves", async () => {
  const llaves = await generarLlaveNoExportable();
  const mensaje = new TextEncoder().encode("mesa 045123, Juliaca");
  const firma = await firmarConWebCrypto(llaves.privateKey, mensaje);
  assert.equal(verificarFirma(firma, mensaje, await llavePublicaHex(llaves.publicKey)), true);
});

test("verificarFirma devuelve false ante datos mal formados en lugar de fallar", () => {
  assert.equal(verificarFirma("zz", new Uint8Array(), "00"), false);
  assert.equal(verificarFirma("00".repeat(64), new Uint8Array(), "00".repeat(32)), false);
});

test("documento firmado: cambiar el contenido rompe la verificación", async () => {
  const llaves = await generarLlaveNoExportable();
  const llavePublica = await llavePublicaHex(llaves.publicKey);
  const documento = await firmarDocumento(llaves.privateKey, { mesa: "045123", renglon: 7 });
  assert.equal(await verificarDocumento(documento, llavePublica), true);
  const alterado = { ...documento, contenido: { mesa: "045123", renglon: 8 } };
  assert.equal(await verificarDocumento(alterado, llavePublica), false);
});
