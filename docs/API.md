# UNICOM · Contrato entre el backend y el frontend

*Versión 0.2.0 · 22 de noviembre de 2026. Lo mantiene Claude Code; el frontend (`web/`) se escribe a partir de este documento. Los ejemplos son respuestas reales del Worker (en el simulador local o en internet).*

**Dirección del API desplegado:** `https://unicom-api.unicom-puno.workers.dev` (funcionando desde el 22/11/2026; la prueba de punta a punta pasó contra esta dirección).

**Llave pública del servidor desplegado:** `c286960620490b46aa90cca001d41a626606d447ce59308c78f3086635ccd265` (está en la génesis, `GET /raices`, raíz n.º 0, y en `raices/0000-genesis.json` cuando corra la publicación).

**Resumen de rutas**

| Ruta | Para qué | Quién |
|---|---|---|
| `POST /actas` | Enviar el acta firmada; devuelve el recibo | App de mesa |
| `POST /fotos` | Subir la foto del acta o del precinto | App de mesa |
| `POST /lector` | Pedir la lectura de Claude antes de sellar | App de mesa |
| `POST /decisiones` | Anotar qué decidió Rosa ante la lectura | App de mesa |
| `POST /opiniones` | Objetar o respaldar un acta | Vista del partido |
| `POST /padron` | Registrar una llave firmada por la ONPE o un partido | Vista del partido / ONPE |
| `POST /reemplazos` | Reemplazar la llave perdida de un miembro de mesa | ONPE |
| `GET /actas/{mesa}`, `/tablero`, `/cuaderno`, `/recibos/{n}`, `/raices`, `/mesas`, `/fotos`, `/fotos/{huella}`, `/volcados/{archivo}`, `/llave-servidor` | Leer y verificar | Verificador, partidos, auditores |
| `POST /autoridades`, `POST /raices`, `POST /rotar-llave` | Administración | Solo con `CLAVE_ADMIN` |

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
  "raiz_tablero": { "huella": "296803ff…3c4c", "sumas": [120, 92, 6, 4, 1] },
  "alertas": [
    { "codigo": "foto_no_subida", "mensaje": "La foto todavía no está en el servidor; súbala con POST /fotos cuando haya señal" }
  ]
}
```
(`raiz_tablero` solo viene cuando `repetida` es `false`.)

`alertas` **avisa pero nunca frena el acta** (el papel manda). Puede traer:
- `foto_no_subida`: el servidor aún no tiene una foto con `foto_sha256`. Conviene subirla con `POST /fotos` (antes o después).
- `foto_repetida`: la misma foto ya está en el acta de otra mesa (`mesas` dice cuáles). Lo verán el auditor y el Carril A.

**Qué debe hacer la web con el recibo:** verificarlo con `verificarDocumento(recibo, llavePublicaDelServidor)`, comprobar que `recibo.contenido.huella_acta` sea la huella que firmó Rosa, y **guardarlo en el celular** (es la prueba de que el servidor recibió el acta).

Errores:

| HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `json_invalido` | El cuerpo no es JSON. |
| 400 | `paquete_invalido` | Faltan campos, sobran, o algún valor no cumple; `detalles` lista cada problema. |
| 400 | `firma_invalida` | Alguna firma no corresponde a la huella del paquete, o falta la del miembro de mesa. |
| 403 | `firmante_no_registrado` | Una llave no está en el padrón, tiene otro rol, es de otra mesa o fue reemplazada. |
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
  "raiz": { "huella": "296803ff1718e2152e80dd93d8de1b668930a6331f79490e94803cfb11313c4c", "sumas": [120, 92, 6, 4, 1] },
  "opiniones": [
    { "renglon": 6, "mesa": "045123", "huella_acta": "2156919d…135b", "tipo": "respaldo", "llave_publica": "022d3918…28e6" }
  ],
  "lecturas_ia": [
    { "renglon": 4, "mesa": "045123", "momento": "antes_del_sello", "modelo": "claude-fable-5-2", "estado": "lectura_pendiente" }
  ]
}
```
`opiniones` son las objeciones y respaldos firmados (pueden ser sobre un acta anterior: compare `huella_acta`). `lecturas_ia` resume cada lectura; el detalle completo está en su renglón del cuaderno.

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

### `GET /mesas`

```json
{ "mesas": ["045123"] }
```
Todas las mesas con acta, ordenadas. Es la lista que entra al sorteo del Carril B (`sortearMesas`).

### `GET /`

```json
{ "sistema": "UNICOM", "version": "0.2.0", "documentacion": "docs/API.md" }
```

### `POST /fotos` · subir una foto por su huella

El cuerpo son los **bytes originales** de la foto (sin JSON, sin recomprimir). Encabezados:

| Encabezado | Valor |
|---|---|
| `content-type` | `image/jpeg`, `image/png` o `image/webp` |
| `x-unicom-llave` | llave pública de quien sube (miembro de mesa o personero del padrón) |
| `x-unicom-firma` | `firmarHuella(llavePrivada, await huellaHex(bytes))` |

Respuesta `201` (nueva) o `200` (ya estaba):
```json
{ "huella": "0867c84a6f9c28be966533c3f9661996f12063e7c9c4c01227e2e629fb26b36e", "tamano": 55, "ya_existia": false }
```
Errores: `415 tipo_no_permitido`, `413 foto_muy_grande` (más de 10 MB), `400 firma_invalida`, `403 firmante_no_registrado`.

### `GET /fotos/{huella}` y `GET /fotos?desde=&limite=`

`/fotos/{huella}` devuelve los bytes de la foto. Quien la baja **debe** comprobar `await huellaHex(bytes) === huella`: así sirve cualquier copia (R2, repositorio, celular). Error `404 foto_inexistente`.
`/fotos?desde=<fecha ISO>&limite=100` lista las fotos guardadas:
```json
{ "fotos": [ { "huella": "0867c84a…b36e", "tipo": "image/jpeg", "tamano": 55, "fecha": "2026-11-23T03:09:55.310Z" } ] }
```

### `POST /lector` · lectura de Claude antes de sellar (con candado)

Cuerpo:
```json
{
  "mesa": "045123",
  "momento": "antes_del_sello",
  "fecha": "2026-11-27T21:30:00.000Z",
  "huella_foto": "<SHA-256 de la foto ORIGINAL>",
  "huella_imagen_enviada": "<SHA-256 de la imagen reducida que va en imagen_base64>",
  "tipo_imagen": "image/jpeg",
  "imagen_base64": "<la imagen reducida con canvas, máximo 5 MB>",
  "llave_publica": "<llave de Rosa>",
  "firma": "<firmarHuella(llavePrivada, await huellaDeObjeto(contenidoPeticionLectura(cuerpo)))>"
}
```
`momento` es `antes_del_sello` o `despues_del_sello`. Candado (arquitectura, sec. 5.4): la firma debe ser de un miembro de **esa** mesa en el padrón; `fecha` a menos de 5 minutos de la hora del servidor; cada petición firmada se usa **una sola vez**; máximo **5 lecturas por mesa**.

Respuesta `200` cuando Claude leyó (formato probado con un Claude simulado; todavía no hay una lectura real porque falta la clave):
```json
{
  "estado": "leida",
  "lectura": {
    "P01": { "valor": 120, "confianza": 0.97, "tachon": false },
    "nulos": { "valor": null, "confianza": 0.2, "tachon": true }
  },
  "modelo": "claude-fable-5-2",
  "renglon": 4
}
```
(`lectura` trae las 5 categorías; `valor: null` = no legible.) La web pasa `lectura` a `contrastar(lectura, votosDigitados)` para pintar verde, amarillo o rojo.

Respuesta `200` real cuando no hay lectura (hoy, porque falta la clave de Claude):
```json
{ "estado": "lectura_pendiente", "motivo": "lector_no_configurado", "modelo": "claude-fable-5-2", "renglon": 4 }
```
Otros `motivo`: `lector_saturado`, `lector_no_disponible`, `lector_rechazo_la_peticion`, `clave_del_lector_invalida`, `lector_se_nego`, `sin_conexion_con_el_lector`, `respuesta_ilegible`, `respuesta_incompleta`, `limite_de_lecturas_de_la_mesa`. **En todos los casos Rosa puede sellar igual** (regla 2); no se usa otra IA.
Errores del candado: `400 peticion_invalida`, `400 imagen_invalida`, `400 imagen_no_coincide`, `400 peticion_vencida`, `400 firma_invalida`, `403 firmante_no_registrado`, `409 peticion_repetida`, `413 imagen_muy_grande`.

### `POST /decisiones` · qué decidió Rosa ante la lectura

Cuerpo: `await firmarObjeto(llavePrivada, llavePublica, { renglon_lectura: 4, decision: "corrigio" })`, con `decision` en `acepto_lectura`, `mantuvo_lo_digitado` o `corrigio`. Respuesta `201` `{ "renglon": 7, "huella_renglon": "…" }`. Lo firma un miembro de la misma mesa. Errores: `400 decision_invalida`, `400 firma_invalida`, `403 firmante_no_registrado`, `404 lectura_inexistente`.

### `POST /opiniones` · objeción o respaldo de un partido (Paso 7)

Cuerpo: `await firmarObjeto(llavePrivada, llavePublica, { tipo: "objecion", mesa: "045123", huella_acta: "…", motivo: "el total de nulos no se lee en la foto" })`. `tipo` es `objecion` o `respaldo`; `motivo` es texto ASCII de 1 a 200 caracteres (sin tildes, porque va en JSON canónico). Lo firma alguien del padrón o una autoridad. Respuesta `201`:
```json
{ "renglon": 6, "huella_renglon": "…", "sobre_acta_vigente": true }
```
Errores: `400 opinion_invalida`, `400 firma_invalida`, `403 firmante_no_registrado`, `404 mesa_sin_acta`.

### `POST /padron` · registrar una llave (Paso 0)

Forma normal, **firmada por una autoridad** (no necesita clave de administración):
```js
const entrada = { llave_publica: "…", mesa: "045123", partido: null, rol: "miembro" };   // personero: mesa null, partido "P02"
const cuerpo = await firmarObjeto(llavePrivadaDeLaAutoridad, llavePublicaDeLaAutoridad, entrada);
```
Las cuatro claves de `entrada` van siempre (la que no corresponde, en `null`). La ONPE registra miembros y personeros; cada partido, solo a sus personeros. Respuesta `201`:
```json
{ "renglon": 3, "huella_renglon": "…", "entrada": { "llave_publica": "…", "mesa": "045123", "partido": null, "rol": "miembro" }, "provisional": false }
```
Forma **provisional** (piloto): la entrada sin firma, con `Authorization: Bearer <CLAVE_ADMIN>`; queda con `provisional: true`.
Errores: `400 padron_invalido`, `400 firma_invalida`, `401 no_autorizado`, `403 autoridad_desconocida`, `403 autoridad_sin_permiso`, `409 llave_ya_registrada`.
La app de Rosa debe comprobar sola que su llave aparece en `GET /cuaderno` (renglones `padron`) y avisar si no (vigilancia de la llave propia, CONIKS).

### `POST /reemplazos` · Rosa perdió su llave (arquitectura, sec. 5.2)

Cuerpo: `await firmarObjeto(llaveONPE, llavePublicaONPE, { mesa: "045123", llave_vieja: "…", llave_nueva: "…", motivo: "cambio de celular" })`. Desde ese renglón la llave vieja ya no firma; las actas anteriores siguen válidas. Errores: `400 reemplazo_invalido`, `400 firma_invalida`, `403 autoridad_sin_permiso`, `409 llave_vieja_desconocida`, `409 llave_ya_reemplazada`, `409 llave_ya_registrada`.

### `GET /volcados/raiz-NNNNNN.json` · para auditores

Con cada raíz publicada se guarda en R2 el tramo nuevo del cuaderno: `{ "desde": 3, "hasta": 6, "raiz": {…}, "renglones": [ … ] }`. Ejemplo: `/volcados/raiz-000002.json`.

### Endpoints de administración (no los usa la web pública)

Llevan el encabezado `Authorization: Bearer <CLAVE_ADMIN>`. Sin él: `401 no_autorizado`.

- **`POST /autoridades`**: `{ "nombre": "ONPE", "llave_publica": "…" }` (o `"P01"`, `"P02"` para un partido). Respuesta `201`. Errores: `400 autoridad_invalida`, `409 autoridad_ya_registrada`.
- **`POST /raices`**: publica una raíz nueva (la primera vez, también la génesis). Con `{ "solo_si_cambio": true }` no publica si el cuaderno no creció. Además, **el Worker publica solo cada 10 minutos** si hubo cambios.
- **`POST /rotar-llave`**: `{ "motivo": "…" }`. Requiere el secreto `LLAVE_SERVIDOR_NUEVA`; la llave vieja firma una raíz `tipo: "rotacion"` con la nueva, y desde ahí los recibos se firman con la nueva (arquitectura, sec. 5.3).

### Tipos de renglón del cuaderno

`autoridad`, `padron`, `reemplazo_llave`, `acta`, `opinion`, `lectura_ia`, `decision_lectura`. Ejemplo real de `lectura_ia` (la confianza va en milésimas, `confianza_milesimas`, porque el JSON canónico solo admite enteros):
```json
{
  "numero": 4,
  "tipo": "lectura_ia",
  "huella_anterior": "2eb95cfaaeac2cf7dda642eb32a17895699b165386f089771ea1b6f51300ba0e",
  "contenido": {
    "estado": "lectura_pendiente",
    "fecha": "2026-11-23T03:09:58.883Z",
    "huella_foto": "0867c84a6f9c28be966533c3f9661996f12063e7c9c4c01227e2e629fb26b36e",
    "llave_publica": "022d391879f7233eecf4f3071e3f7919c9d4ff599948ddceafc5c112647628e6",
    "mesa": "045123",
    "modelo": "claude-fable-5-2",
    "momento": "antes_del_sello",
    "resultado": { "motivo": "lector_no_configurado" }
  },
  "huella": "391f9590db698e3e97fb1db8c49c069e8ed73205b60823b234408da51b6e98f0"
}
```
`reconstruirEstado(renglones)` del núcleo vuelve a comprobar cada renglón con datos públicos solamente.

## 5. El núcleo en el navegador

El núcleo está en `nucleo/` y se carga como **módulo ES, sin compilar**. Solo depende de `@noble/curves` (Ed25519 para firmas y BLS12-381 para drand). La web **no** debe importar nada de `api/`: ahí está el SDK de Anthropic, que vive solo en el servidor. Como el navegador no entiende el nombre `@noble/curves/...`, la página necesita un **import map** antes de cualquier `<script type="module">`:

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
| `revisarSumas({ votos, electoresHabiles, ciudadanosVotaron, cedulasActaSufragio })` | lo que digitó Rosa (`cedulasActaSufragio` es opcional) | `[{ codigo, campo, mensaje }]` avisos del Paso 3 (vacío si cuadra); **avisa, no bloquea** |
| `contrastar(lectura, votosDigitados, umbral = 0.8)` | `lectura` de `POST /lector` (o `null`) | `{ estado, campos }`: `estado` es verde, amarillo, rojo o lectura_pendiente; cada campo trae `{ color, motivo, valor_ia, valor_digitado }` |
| `contenidoPeticionLectura(cuerpo)` | cuerpo de `POST /lector` | lo que hay que firmar con `huellaDeObjeto` + `firmarHuella` |
| `firmarObjeto(llavePrivada, llavePublica, contenido)` | — | `Promise<{ contenido, llave_publica, firma }>` para padrón, reemplazos, opiniones y decisiones |
| `verificarObjetoFirmado(objeto)` | objeto firmado | `Promise<boolean>` |
| `huellaDeObjeto(objeto)` | cualquier objeto canónico | `Promise<string>` |
| `reconstruirEstado(renglones)` | cuaderno completo | `Promise<{ padron, autoridades, actas, opiniones, lecturas, problemas }>` (todo vuelto a comprobar) |
| `totalesDelEstado(estado)` | resultado anterior | totales por categoría |
| `verificarRondaDrand({ round, signature, randomness })` | ronda de `https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/<ronda>` | `Promise<boolean>` (firma BLS de drand quicknet) |
| `rondaDrandEnFecha(fecha)` | fecha ISO | número de ronda de drand quicknet en ese momento |
| `verificarEncabezadoBitcoin(encabezadoHex, hashBloque)` | de `https://mempool.space/api/block/<hash>/header` | `Promise<boolean>` |
| `semillaSorteo({ dados, firmaDrand, hashBloque })` | al menos 10 tiradas del 1 al 6 | `Promise<string>` semilla del Carril B |
| `sortearMesas({ semilla, mesas, cantidad })` | `mesas` de `GET /mesas` | `Promise<string[]>` (método de Rivest, probado con sus casos públicos) |
| `sortearCedulas({ semilla, mesa, totalCedulas, cantidad })` | — | `Promise<number[]>` números de cédula dentro del sobre |
| `compararTableros(anclado, actual)`, `examinarActa(...)` | árboles de `construirTablero` | lo que usa el detective (ver `auditor/investigacion.js`) |

`verificarCadenaRaices` devuelve además `llaveVigente`: la llave del servidor después de cualquier rotación.

## 6. Auditores, detective y anclaje (para el panel del auditor)

Todo corre con Node desde la raíz del repositorio y usa solo datos públicos:

| Comando | Qué hace |
|---|---|
| `node auditor/correr-auditor.js` | Las 7 revisiones del Paso 9; escribe `auditor/publicado/informe.json` (alertas y resumen) y `auditor/publicado/ultima-vista.json` (la raíz que vio, para que otros comparen) |
| `node auditor/detective.js --arbol auditor/arboles/raiz-0003.json` | Merkle-diff contra un árbol anclado; dice qué mesa cambió, si la firma se rompió y la huella de la foto |
| `node auditor/verificar-anclajes.js` | Comprueba cada `raices/*.json.ots` contra la raíz de Merkle del bloque de Bitcoin (javascript-opentimestamps + mempool.space o blockstream.info) |
| `npm run simular-ataque` | Demostración sin internet: Sol 120 → 150 en la base, alerta del auditor y hallazgo del detective |

Formato de `informe.json`: `{ fecha, alertas: [{ revision, mensaje, detalle }], avisos: [...], resumen: { fuente, renglones, actas, raices, totales } }`. Las revisiones van del 1 al 7, en el orden de la arquitectura, sec. 7.1.

Archivos públicos en el repositorio: `raices/NNNN.json` (JSON canónico de cada raíz firmada), `raices/NNNN.json.ots` (su sello), `fotos/<huella>.jpg`, `auditor/arboles/raiz-NNNN.json` (`{ numero, huella, raiz_tablero, renglones, hojas: [{ casillero, huellaActa, sumas }] }`).

## 7. Lo que falta y depende del autor

- **Lector de IA real:** cargar créditos en la consola de Anthropic, fijar un tope de gasto y guardar el secreto `ANTHROPIC_API_KEY` en el Worker. Hasta entonces responde `lectura_pendiente`.
- **Publicación y anclaje automáticos:** los flujos de GitHub Actions corren cuando esta rama llegue a `main` en GitHub.
- **Numeración de mesas de la ONPE:** hoy casillero = número de mesa (hasta 131071).
