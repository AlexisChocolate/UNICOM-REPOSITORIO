# UNICOM · Contrato entre el backend y el frontend

*Versión 0.1.0 · 22 de noviembre de 2026. Lo mantiene Claude Code; el frontend (`web/`) se escribe a partir de este documento. Todos los ejemplos son respuestas reales del Worker corriendo en el simulador local de Cloudflare.*

**Dirección del API desplegado:** `https://unicom-api.<subdominio>.workers.dev` (se completa cuando el autor despliegue; el subdominio lo elige él en Cloudflare).

## 1. Reglas generales

- Todo es JSON en UTF-8. Las huellas, llaves y firmas van en **hexadecimal en minúscula**: una huella SHA-256 tiene 64 caracteres; una llave pública Ed25519, 64; una firma Ed25519, 128.
- **JSON canónico** (lo que se firma): claves ordenadas, sin espacios, solo enteros, `true`/`false`/`null` y texto ASCII imprimible. Nada de tildes ni decimales: los partidos van como códigos (`"P01"`). La web **no** debe armarlo a mano: usa `canonico()` o `huellaActa()` del núcleo.
- **CORS:** el Worker solo deja leer sus respuestas a páginas de `https://alexischocolate.github.io`, `http://localhost:8000` y `http://127.0.0.1:8000`. Si la web se sirve desde otro lugar, hay que avisar para agregarlo en `wrangler.toml`.
- **Errores:** siempre con esta forma y el código HTTP correspondiente:
  ```json
  { "error": "mesa_sin_acta", "mensaje": "La mesa 045999 todavía no tiene un acta registrada" }
  ```
  Algunos traen `detalles` (lista de problemas o datos útiles). La web debe mostrar `mensaje` y, si existe, cada línea de `detalles`.

## 2. Categorías de votos del piloto

| Código | Nombre que muestra la web |
|---|---|
| `P01` | Partido Sol |
| `P02` | Partido Río |
| `blancos` | Votos en blanco |
| `nulos` | Votos nulos |
| `impugnados` | Votos impugnados |

El orden de esta lista es parte del árbol (cambiarlo cambia todas las raíces) y queda fijado en la génesis. Está en `CATEGORIAS` y `NOMBRES_CATEGORIAS` del núcleo.

## 3. El paquete del acta y cómo se firma

```json
{
  "mesa": "045123",
  "votos": { "P01": 120, "P02": 92, "blancos": 6, "nulos": 4, "impugnados": 1 },
  "foto_sha256": "a31d4a91f43e5c1fdd5a75dff720b5f96a0668fa4f128c3febbaf4a8aaab0acb",
  "precinto_sha256": null,
  "precinto_numero": null,
  "fecha_hora_declarada": "2026-11-27T16:05:00-05:00",
  "personeros_presentes": false,
  "reemplaza_a": null
}
```

| Campo | Regla |
|---|---|
| `mesa` | 6 dígitos como texto. Hoy el casillero del tablero es el mismo número (`045123` → 45123) y debe ser menor que 131 072 (pendiente confirmar la numeración de la ONPE). |
| `votos` | Exactamente las 5 categorías, enteros ≥ 0. El servidor **no** revisa si las sumas cuadran: eso lo hace la web y solo avisa (Paso 3). |
| `foto_sha256` | SHA-256 de los **bytes originales** de la foto del acta. |
| `precinto_sha256`, `precinto_numero` | Huella de la foto del precinto y su número (1 a 32 letras, dígitos o guiones), o `null` mientras no se use. |
| `fecha_hora_declarada` | ISO 8601 del celular. Es la hora *declarada*; la confiable es la del recibo. |
| `personeros_presentes` | `true` o `false`. |
| `reemplaza_a` | `null`, o la `huella_acta` vigente de la mesa si es una corrección. |

No se aceptan campos extra ni faltantes.

**Cómo firmar (Rosa, en el navegador):**
1. `huella = await huellaActa(paquete)` → texto hexadecimal de 64 caracteres.
2. `firma = await firmarHuella(llavePrivadaDeRosa, huella)`: firma con **Web Crypto** los 32 bytes de la huella (no el texto). La llave se crea con `generarLlaveNoExportable()` y nunca sale del navegador.
3. Cada personero presente firma la **misma** huella (opcional).

## 4. Endpoints

### `POST /actas` · enviar un acta firmada (sin clave)

Entrada:
```json
{
  "paquete": { "...": "el paquete de la sección 3" },
  "firmas": [
    {
      "rol": "miembro",
      "llave_publica": "de06abe0fda6209f44c6e3a4373704da34742161fafb98c92074387d5d261b21",
      "firma": "7735d094181441093f0ae780ff453442d7437257d59e3aca3504d25907ed1cfa7ae74efda2adce19b5ea8c0870ec768b007ecb188340b4a0ca3c3e5ea6025307"
    }
  ]
}
```
- De 1 a 5 firmas; al menos una con `rol: "miembro"`. `rol` es `"miembro"` o `"personero"`.
- Cada llave tiene que estar en el padrón con ese rol; un miembro, además, registrado en esa misma mesa.

Respuesta `201` (acta nueva) o `200` (la misma acta ya había llegado: se devuelve el mismo recibo, así que reintentar es seguro):
```json
{
  "recibo": {
    "contenido": {
      "hora_llegada": "2026-11-23T01:08:36.810Z",
      "huella_acta": "8531d8fdc0dabf4089e6fd30f81bf321c28447a0c5f49b5c3cf6d0b982bdb9cd",
      "huella_renglon": "b6fcda162ed4c8c34c18f7b68fceb37bb5af602a6ef381210a1601e98ee104e3",
      "mesa": "045123",
      "renglon": 4,
      "tipo": "recibo"
    },
    "huella": "766af37afc268d5688e64a397d910b2a8455e01bb12266bf5a88bd1c1dfc8ad0",
    "firma": "10aa890636b7c03b8f07c186b4c33df2e7b15636bf648b4902c305eff4a69bc35a1422a50f955dd36c98f93b28620f5d84c65c2c54c070379ac73e2c20c5d007"
  },
  "repetida": false,
  "raiz_tablero": { "huella": "296803ff…3c4c", "sumas": [120, 92, 6, 4, 1] }
}
```
(`raiz_tablero` solo viene cuando `repetida` es `false`.)

**Qué debe hacer la web con el recibo:** verificarlo con `verificarDocumento(recibo, llavePublicaDelServidor)`, comprobar que `recibo.contenido.huella_acta` sea la huella que firmó Rosa, y **guardarlo en el celular** (es la prueba de que el servidor recibió el acta).

Errores:

| HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `json_invalido` | El cuerpo no es JSON. |
| 400 | `paquete_invalido` | Faltan campos, sobran, o algún valor no cumple; `detalles` lista cada problema. |
| 400 | `firma_invalida` | Alguna firma no corresponde a la huella del paquete, o falta la del miembro de mesa. |
| 403 | `firmante_no_registrado` | Una llave no está en el padrón, tiene otro rol o es de otra mesa. |
| 409 | `mesa_ya_registrada` | La mesa ya tiene otra acta y `reemplaza_a` no lleva su huella; `detalles.huella_acta_vigente` la trae. |
| 409 | `reemplazo_sin_acta` | `reemplaza_a` no es `null` pero la mesa no tiene acta. |
| 413 | `cuerpo_muy_grande` | Más de 64 KB. |
| 503 | `llave_no_configurada` | El servidor todavía no tiene su llave. |

### `GET /actas/{mesa}` · acta vigente de una mesa y su prueba de inclusión

Respuesta `200` (recortada: `hermanos` trae siempre 17 elementos, del nivel 0 al 16):
```json
{
  "mesa": "045123",
  "casillero": 45123,
  "huella_acta": "8531d8fdc0dabf4089e6fd30f81bf321c28447a0c5f49b5c3cf6d0b982bdb9cd",
  "renglon": 4,
  "paquete": { "mesa": "045123", "votos": { "P01": 120, "P02": 92, "blancos": 6, "nulos": 4, "impugnados": 1 }, "...": "..." },
  "firmas": [ { "rol": "miembro", "llave_publica": "de06…1b21", "firma": "7735…5307" } ],
  "sumas": [120, 92, 6, 4, 1],
  "hermanos": [
    { "huella": "dbc1b4c900ffe48d575b5da5c638040125f65db0fe3e24494b76ea986457d986", "sumas": [0, 0, 0, 0, 0] }
  ],
  "raiz": { "huella": "296803ff1718e2152e80dd93d8de1b668930a6331f79490e94803cfb11313c4c", "sumas": [120, 92, 6, 4, 1] }
}
```
Para comprobarlo, la web llama a `verificarInclusion({ casillero, huellaActa: huella_acta, sumas, hermanos, raiz })` y además: `await huellaActa(paquete) === huella_acta` y cada firma con `verificarFirmaDeHuella`. Errores: `400 mesa_invalida`, `404 mesa_sin_acta`.

### `GET /tablero` · raíz actual y totales

```json
{
  "categorias": ["P01", "P02", "blancos", "nulos", "impugnados"],
  "niveles": 17,
  "raiz_tablero": "296803ff1718e2152e80dd93d8de1b668930a6331f79490e94803cfb11313c4c",
  "totales": { "P01": 120, "P02": 92, "blancos": 6, "nulos": 4, "impugnados": 1 },
  "ultimo_renglon": { "numero": 4, "huella": "b6fcda162ed4c8c34c18f7b68fceb37bb5af602a6ef381210a1601e98ee104e3" }
}
```
Esto **no está firmado**: es el estado en vivo. Lo firmado y verificable son las raíces publicadas (`GET /raices`).

### `GET /cuaderno?desde=1&limite=100` · renglones del cuaderno

`desde` ≥ 1 (por defecto 1), `limite` de 1 a 500 (por defecto 100).
```json
{
  "renglones": [
    {
      "numero": 1,
      "tipo": "padron",
      "huella_anterior": "0000000000000000000000000000000000000000000000000000000000000000",
      "contenido": { "llave_publica": "853e…a8b1", "mesa": "045123", "partido": null, "rol": "miembro" },
      "huella": "13c01eb716d7ee6727fb5997a242fc22ed006f56687d4c3a3e82cf81d0f7bdda"
    },
    {
      "numero": 2,
      "tipo": "acta",
      "huella_anterior": "13c01eb716d7ee6727fb5997a242fc22ed006f56687d4c3a3e82cf81d0f7bdda",
      "contenido": { "firmas": [ "..." ], "huella_acta": "5ec29abe…6e7b", "paquete": { "...": "..." } },
      "huella": "082a2fb907c4d61c3b1a9a5f7f939670b730a227afb05749014a2cad860fff92"
    }
  ]
}
```
Tipos de renglón: `padron` y `acta`. Se comprueba con `verificarCuaderno(renglones)`.

### `GET /recibos/{renglon}` · recibo de un renglón

Devuelve el mismo objeto `recibo` de `POST /actas`. Error: `404 recibo_inexistente`.

### `GET /raices?desde=0&limite=100` · cadena de raíces firmadas

```json
{
  "raices": [
    {
      "contenido": {
        "categorias": ["P01", "P02", "blancos", "nulos", "impugnados"],
        "fecha": "2026-11-23T01:08:36.198Z",
        "huella_raiz_anterior": "0000000000000000000000000000000000000000000000000000000000000000",
        "llave_publica_servidor": "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        "niveles": 17,
        "numero": 0,
        "sistema": "UNICOM",
        "tipo": "genesis"
      },
      "huella": "4c4e3967ecacbee28bb63016f8b895c6552f777d062acc38c085aef173137aa2",
      "firma": "e0e309ea…2308"
    },
    {
      "contenido": {
        "fecha": "2026-11-23T01:08:36.198Z",
        "huella_cuaderno": "082a2fb907c4d61c3b1a9a5f7f939670b730a227afb05749014a2cad860fff92",
        "huella_raiz_anterior": "4c4e3967ecacbee28bb63016f8b895c6552f777d062acc38c085aef173137aa2",
        "numero": 1,
        "raiz_tablero": "25b92182be0c5c47a7dc11f994e829fa600a7a1840ba6d3bc550289edd93195e",
        "renglones": 2,
        "tipo": "raiz",
        "totales": { "P01": 120, "P02": 83, "blancos": 6, "nulos": 4, "impugnados": 1 }
      },
      "huella": "b8b008fb2f18265469bd6d9e68a9fb45266b4decc9b45f97b08f77f30dca527d",
      "firma": "1530f008…6d09"
    }
  ]
}
```
(En el ejemplo, la llave del servidor es la del vector de prueba público TEST 1 de RFC 8032, usada solo en local.) La número 0 es la **génesis**: fija la llave pública del servidor, las categorías y los niveles del árbol. Se comprueba con `verificarCadenaRaices(raices, llavePublicaEsperada)`. Más adelante, el verificador leerá estas raíces desde la carpeta `raices/` del repositorio y no desde el Worker (Paso 12).

### `GET /llave-servidor`

```json
{ "llave_publica": "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "algoritmo": "Ed25519" }
```
Sirve para mostrarla, pero **la de confianza es la de la génesis** (`raices[0].contenido.llave_publica_servidor`): si el servidor fuera atacado, este endpoint podría mentir; la génesis publicada y anclada, no.

### `GET /`

```json
{ "sistema": "UNICOM", "version": "0.1.0", "documentacion": "docs/API.md" }
```

### Endpoints de administración (no los usa la web pública)

Llevan el encabezado `Authorization: Bearer <CLAVE_ADMIN>`. Sin él: `401 no_autorizado`.

- **`POST /padron`**: registra una llave. Entrada `{ "rol": "miembro", "mesa": "045123", "llave_publica": "…" }` o `{ "rol": "personero", "partido": "P01", "llave_publica": "…" }`. Respuesta `201`:
  ```json
  { "renglon": 1, "huella_renglon": "13c01eb7…bdda", "entrada": { "llave_publica": "853e…a8b1", "mesa": "045123", "partido": null, "rol": "miembro" } }
  ```
  Errores: `400 padron_invalido`, `409 llave_ya_registrada`.
- **`POST /raices`**: publica una raíz nueva con el estado actual (la primera vez crea también la génesis). Respuesta `201` `{ "publicadas": [ …documentos como en GET /raices… ] }`.

> **Provisional:** hoy el padrón lo carga el administrador. El plan (Paso 0) pide un padrón firmado por cada partido o la ONPE y el reemplazo de llaves; viene en la siguiente versión. La app de mesa debería mostrar la llave pública de Rosa para que el administrador la registre.

## 5. El núcleo en el navegador

El núcleo está en `nucleo/` y se carga como **módulo ES, sin compilar**. Solo depende de `@noble/curves` (para verificar firmas). Como el navegador no entiende el nombre `@noble/curves/...`, la página necesita un **import map** antes de cualquier `<script type="module">`:

```html
<script type="importmap">
{ "imports": { "@noble/curves/": "https://esm.sh/@noble/curves@2.4.0/" } }
</script>
<script type="module">
  import { huellaActa, verificarDocumento } from "./nucleo/index.js";
</script>
```

- La URL de esm.sh responde (comprobado el 22/11/2026). **No se ha probado todavía en un navegador**: le toca al chat del frontend. La web necesita acceso a la carpeta `nucleo/` (copiarla o servirla desde la raíz del repositorio en GitHub Pages).
- Necesita un navegador con Ed25519 en Web Crypto (Chrome actual). Si `generarLlaveNoExportable()` falla, la app debe avisar (arquitectura, sec. 5.1).

### Funciones que usa la web (todas desde `nucleo/index.js`)

| Función | Parámetros | Devuelve |
|---|---|---|
| `huellaHex(bytes)` | `Uint8Array` (por ejemplo, la foto con `new Uint8Array(await archivo.arrayBuffer())`) | `Promise<string>` huella SHA-256 en hexadecimal |
| `huellaActa(paquete)` | paquete de la sección 3 | `Promise<string>` huella del JSON canónico |
| `canonico(valor)` | cualquier valor permitido | `string` JSON canónico; lanza error si hay tildes o decimales |
| `validarPaquete(paquete)` | paquete | `string[]` problemas de formato (vacío si está bien) |
| `generarLlaveNoExportable()` | — | `Promise<CryptoKeyPair>` Ed25519 no exportable (guardarla en IndexedDB) |
| `llavePublicaHex(llavePublica)` | `CryptoKey` pública | `Promise<string>` 64 caracteres |
| `firmarHuella(llavePrivada, huellaHex)` | `CryptoKey` privada, huella | `Promise<string>` firma de 128 caracteres (Web Crypto) |
| `verificarFirmaDeHuella(firmaHex, huellaHex, llavePublicaHex)` | textos hex | `boolean` (con @noble/curves) |
| `verificarDocumento(documento, llavePublicaHex)` | recibo o raíz firmada | `Promise<boolean>` |
| `verificarInclusion({ casillero, huellaActa, sumas, hermanos, raiz })` | datos de `GET /actas/{mesa}` | `Promise<boolean>` |
| `verificarCuaderno(renglones, anterior?)` | lista de `GET /cuaderno`; `anterior` es el último renglón ya revisado | `Promise<{ valido, renglon?, motivo?, ultimo? }>` |
| `verificarCadenaRaices(raices, llavePublicaEsperada?)` | lista de `GET /raices` | `Promise<{ valida, motivo?, numero?, ultima?, llavePublica? }>` |
| `casilleroDeMesa(mesa)` | `"045123"` | `number` 45123 |
| `CATEGORIAS`, `NOMBRES_CATEGORIAS` | — | lista de códigos y sus nombres para mostrar |

## 6. Lo que todavía no está (siguientes versiones)

- Subida de la foto a R2 (hoy el servidor solo guarda su huella).
- Padrón firmado por partido u ONPE, vigilancia de la llave propia y reemplazo de llave.
- Publicación de las raíces en `raices/` del repositorio y anclaje en Bitcoin.
- Lector de IA con candado, objeciones y respaldos de partidos, volcados para auditores.
