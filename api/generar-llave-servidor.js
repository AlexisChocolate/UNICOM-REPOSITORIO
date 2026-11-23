// Genera la llave Ed25519 del servidor. La llave privada sale por la salida estándar para entubarla
// directo a `wrangler secret put LLAVE_SERVIDOR`, sin que nadie la copie ni quede en un archivo.
// La llave pública sale por la salida de errores, solo para que el autor la vea.
//
//   node api/generar-llave-servidor.js | npx wrangler secret put LLAVE_SERVIDOR
import { base64urlABytes, bytesAHex } from "../nucleo/bytes.js";

const llaves = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", llaves.privateKey);
const llaveParaGuardar = { crv: jwk.crv, d: jwk.d, kty: jwk.kty, x: jwk.x };

process.stderr.write(`Llave pública del servidor: ${bytesAHex(base64urlABytes(jwk.x))}\n`);
process.stdout.write(JSON.stringify(llaveParaGuardar));
