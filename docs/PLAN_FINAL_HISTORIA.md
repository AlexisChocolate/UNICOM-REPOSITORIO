# UNICOM · Plan final: historia, implementación y fuentes
*22 de noviembre de 2026 · **revisión 1**. Reemplaza a `HISTORIA_Y_PLAN_v4.md`. Incorpora las correcciones de `REVISION_PAPERS_v5.md`, que comparó las citas con los 38 documentos originales, y las de la revisión 1 de `PLAN_FINAL_ARQUITECTURA.md` (firma con Web Crypto, vacíos por nivel, verificación del anclaje, alcance de Subresource Integrity, piloto). Las referencias a secciones (por ejemplo, "sec. 3.3") remiten al documento citado. La arquitectura de despliegue está en `PLAN_FINAL_ARQUITECTURA.md`.*

**Qué cambió respecto de la v4**
- **Paso 9:** se corrige un error. El sello de Bitcoin prueba la *fecha*, pero no que exista *una sola* raíz. Se agregan una cadena de raíces, la publicación en un solo lugar replicado y la comparación entre auditores.
- **Paso 11:** se corrige un error. El sorteo pasa a revisar **cédulas del sobre lacrado** (Ley 32243, art. 300), porque comparar acta contra acta no atrapa un acta falsa desde el origen.
- **Paso 8:** el árbol con sumas se presenta como una **aplicación** de técnicas existentes, no como invento propio, y la hoja incluye el número de casillero.
- Se agregan el recibo firmado (Paso 6), la foto del precinto (Paso 5), el enderezado de la foto (Paso 6), la regla de los votos impugnados (Paso 3), un modelo de amenazas y varias precisiones en las citas.

**Qué cambió en la revisión 1**
- **Pasos 0 y 5:** Rosa **firma con Web Crypto** (su llave no puede salir del navegador) y todos **verifican** con @noble/curves. Se agrega el reemplazo de una llave perdida.
- **Paso 8:** los casilleros vacíos son **iguales por nivel**; la posición la protegen la hoja llena y el camino de la prueba.
- **Paso 9:** el anclaje se verifica con la librería de JavaScript (el cliente Python necesita un nodo Bitcoin) y el auditor vigila que nadie reescriba el historial del repositorio.
- **Paso 12:** lo que prueba que Juan corre el código publicado es el **verificador descargable** con huella anclada, no Subresource Integrity solo.
- El despliegue gratuito es un **piloto** (ver arquitectura, sec. 3.1).

---

## Requisito transversal: web responsive (celular y PC)
Todas las pantallas de UNICOM (app de mesa, verificador ciudadano, vista del partido y panel del auditor) deben funcionar igual de bien en **celular y en PC**:
- Diseño **mobile-first** con CSS Grid y Flexbox: una columna en el celular y varias en la PC, usando *media queries* ([MDN, diseño responsive](https://developer.mozilla.org/en-US/docs/Learn/CSS/CSS_layout/Responsive_Design)).
- Botones y casillas de al menos **44 × 44 px** para tocarlos con el dedo ([WCAG 2.2, criterio 2.5.5](https://www.w3.org/TR/WCAG22/#target-size-enhanced)).
- Las tablas anchas (comparación de la IA, cuaderno) se muestran como **tarjetas** en pantallas angostas, sin desplazamiento horizontal.
- En el celular, la foto se toma con la **cámara** (`capture="environment"`); en la PC, se sube un archivo.
- Se prueba en Chrome de Android y en Chrome o Edge de PC. *Estado:* el prototipo ya usa una grilla adaptable, pero sus tablas todavía no se convierten en tarjetas ⏳.

---

## Reglas que no se rompen
1. **El papel manda:** UNICOM no toca el voto; solo vigila el acta. La foto es evidencia, pero la última palabra la tiene el papel.
2. **La IA solo advierte:** nunca escribe en el acta ni bloquea el sello. Hay un solo lector (Claude). Si falla, el acta queda con "lectura pendiente" y la revisa una persona.
3. **Sin personeros no se frena nada:** firma el miembro de mesa, y la foto sellada hace de testigo.
4. **El servidor puede ser atacado:** por eso todo se verifica con firmas, huellas, raíces publicadas y el anclaje en Bitcoin, sin confiar en el servidor.
5. **Los dos carriles no se mezclan:** la lista de prioridad nunca condiciona el sorteo al azar.
6. **Cualquiera puede comprobarlo:** el verificador y el auditor usan solo datos públicos.

---

## La historia de la mesa 045123

**Personajes:** Rosa (presidenta de mesa en Juliaca), el Partido Sol, el Partido Río (hoy **no mandaron personeros**) y Juan (ciudadano que quiere comprobar el resultado).

### Paso 0 · Antes de la elección: el padrón de sellos
- Cada **miembro de mesa** recibe un sello digital en su celular (**obligatorio**).
- Los **personeros** también pueden tener uno (**opcional**).
- Cada partido publica su lista de sellos: así nadie puede inventarse un firmante falso.
- **La app de Rosa revisa sola que su llave aparezca bien en el padrón publicado**, y avisa si no. Es la idea de CONIKS: cada usuario vigila su propia llave.
- **Si Rosa pierde su llave** (borró los datos del navegador o cambió de celular), se genera una nueva y el partido (o la ONPE) firma un renglón de **reemplazo de llave** que queda en el cuaderno. Las actas firmadas antes siguen siendo válidas.
- *Teoría:* firma digital Ed25519 (RFC 8032); directorio público de llaves y vigilancia de la llave propia, CONIKS (Melara et al., 2015).

**🔧 Implementación**

| | |
|---|---|
| Algoritmo | Par de llaves Ed25519 por firmante. El **padrón** es una lista JSON `{rol, mesa, partido, llave_pública}` firmada con la llave del partido (o de la ONPE) y anotada en el cuaderno. Al verificar una firma: (1) la llave está en el padrón (considerando los reemplazos); (2) la firma es válida. Al publicarse el padrón, la app de cada miembro de mesa comprueba que su propia llave figure en él. Reemplazo: renglón `reemplazo_llave {mesa, llave_vieja, llave_nueva, motivo}` firmado por el partido o la ONPE. |
| Tecnología | Web Crypto API del navegador: `generateKey({name:"Ed25519"}, false, …)`, con la llave privada **no exportable**, y **la firma también con Web Crypto** (`subtle.sign`), porque la llave no puede salir del navegador ([MDN, Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)). Para **verificar**, se usa **una sola librería** en el navegador, en Node y en el auditor ([@noble/curves](https://github.com/paulmillr/noble-curves)), porque librerías distintas pueden discrepar en casos raros (RFC 8032, sec. 8.8). Si el navegador no tiene Ed25519 en Web Crypto, la app avisa (en el piloto se usan celulares con un Chrome actual). Se prueba con los vectores oficiales de RFC 8032, sec. 7.1. |
| Estado | ✅ La llave del miembro de mesa se genera en el prototipo · ⏳ Padrón, vigilancia de la llave propia y reemplazo de llave: **lun 23** |
| Justificación | [RFC 8032, Ed25519](https://www.rfc-editor.org/rfc/rfc8032.html) (secs. 7.1, 8.5 y 8.8) · [Melara et al., 2015, CONIKS](https://eprint.iacr.org/2014/1004.pdf) |

### Paso 1 · Se cuenta en papel, como siempre
- El papel sigue siendo la verdad. UNICOM no toca el voto.
- *Teoría:* Park, Specter, Narula y Rivest (2021) critican el voto por internet o por blockchain, pero aclaran que **no se oponen** a usar tecnología como apoyo en votaciones presenciales con cédulas de papel marcadas a mano (sec. 1.2). Esa es la categoría de UNICOM. Una elección basada en evidencia necesita un rastro en papel confiable, una auditoría de cumplimiento (cadena de custodia) y una auditoría de riesgo limitado (Stark y Wagner, 2012). Una foto **no reemplaza** revisar el papel (Appel y Stark, 2020, sección "Audit the Digital Images?").

**🔧 Implementación**

| | |
|---|---|
| Algoritmo | Ninguno: es el proceso de siempre. UNICOM no toca el voto. |
| Tecnología | — |
| Estado | — |
| Justificación | [Park, Specter, Narula y Rivest, 2021](https://people.csail.mit.edu/rivest/pubs/PSNR20.pdf) · [Stark y Wagner, 2012](https://www.stat.berkeley.edu/~stark/Preprints/evidenceVote12.pdf) · [Appel y Stark, 2020](https://georgetownlawtechreview.org/wp-content/uploads/2020/07/4.2-p523-541-Appel-Stark.pdf) |

### Paso 2 · Primero la foto 📸
- Rosa fotografía el acta y la app calcula al instante la **huella de la foto**.
- Desde que la huella entra al paquete sellado (Paso 5), la foto ya no se puede cambiar sin que se note.
- **Ojo con la hora:** la hora del paquete la pone el celular de Rosa, así que es la hora *declarada*. La hora *confiable* es la del **recibo de llegada** (Paso 6) y la del **anclaje en Bitcoin** (Paso 9).
- *Teoría:* SHA-256 (NIST FIPS 180-4); sellado de tiempo de documentos digitales (Haber y Stornetta, 1991).

**🔧 Implementación**

| | |
|---|---|
| Algoritmo | SHA-256 sobre los **bytes originales** del archivo, sin recomprimir, para que cualquiera obtenga la misma huella. |
| Tecnología | `<input type="file" capture="environment">` (abre la cámara del celular) + `crypto.subtle.digest("SHA-256", …)` ([MDN, Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)). |
| Estado | ✅ En el prototipo |
| Justificación | [NIST FIPS 180-4, SHA-256](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf) · [Haber y Stornetta, 1991](https://link.springer.com/content/pdf/10.1007/bf00196791.pdf) |

### Paso 3 · Rosa digita y la app revisa las sumas
- Si no cuadran, la app **avisa, pero no bloquea**: el error puede estar en el papel, y eso también se registra.
- Los avisos usan **las mismas categorías de error del reglamento del JNE**, así que hablan el mismo idioma que el Jurado Electoral Especial.
- *Por qué:* en el Perú 2026 muchas actas se observaron por sumas mal hechas, casillas vacías o falta de firmas (El Peruano, 16/04/2026).

**🔧 Implementación**

| | |
|---|---|
| Algoritmo | Reglas: enteros ≥ 0; sin casillas vacías; **partidos + blancos + nulos + impugnados = total de ciudadanos que votaron**; ningún partido ni el total de blancos, nulos o impugnados supera a los electores hábiles ni a los ciudadanos que votaron; el total de votantes no es menor que la suma de votos (categorías del reglamento citado en la Res. 1052-2026-JNE, art. 9); el número de cédulas coincide con el de votantes del acta de sufragio (Ley 32243, art. 279). Avisa, no bloquea. |
| Tecnología | Función pura `revisarSumas()` en JavaScript (sin librerías). |
| Estado | ✅ En el prototipo · ⚠️ Agregar los votos impugnados y la regla del art. 279: **lun 23** |
| Justificación | [Ley 32243, arts. 178, 279 y 291](https://busquedas.elperuano.pe/dispositivo/NL/2361612-1) · [Res. 1052-2026-JNE](https://busquedas.elperuano.pe/dispositivo/NL/2515273-1) (reglamento citado, art. 9) · [El Peruano, 16/04/2026](https://elperuano.pe/noticia/293639-conteo-oficial-de-votos-de-la-onpe-entra-en-su-etapa-final) |

### Paso 4 · La IA revisa ANTES de sellar 🤖 (lector: Claude)
- Con la foto y los números listos, y **antes de sellar**, un lector de IA mira la foto y la compara con lo digitado. Así el error de dedo se atrapa **a tiempo**, cuando Rosa todavía tiene el papel en la mano:
  - 🟢 coincide;
  - 🟡 poca confianza, ilegible **o con tachones**: "revise este campo";
  - 🔴 diferente: "la IA leyó 5; usted digitó 4. Revise el papel".
- Si Rosa se equivocó, **corrige ella** mirando el papel, y la tabla se actualiza sola, sin volver a llamar a la IA. Si el papel dice eso, puede sellar igual, y queda registrado que una persona lo decidió.
- **La IA nunca escribe en el acta ni bloquea el sello.**
- **Si no hay señal en la mesa,** Rosa sella sin esperar: el acta queda con "lectura pendiente" y la IA la lee cuando llega a la central. En ese caso el aviso sirve para revisarla después, no para evitar el error en el momento.
- **Un solo lector: Claude.** No se cambia de IA sobre la marcha: todas las actas se revisan con el mismo lector, el modelo más avanzado disponible de Claude. Así la vara es la misma para todas las mesas, y su porcentaje de error, medido una sola vez con fotos reales, vale para todas por igual.

| Dónde | Cómo lee Claude | Costo | Estado |
|---|---|---|---|
| **Dentro de claude.ai** | Versión publicada del prototipo | Gratis con el plan del autor | Programado y publicado; falta capturar una lectura real |
| **Web propia** (GitHub Pages) | API de Claude, con su modelo más avanzado | **De pago (créditos)**: el autor los comprará al implementar | Pendiente; con un intermediario (Cloudflare Worker) que oculta la clave y solo atiende peticiones firmadas por el padrón |
| **Simulado** | Solo para pruebas y como plan B de la demo; **no es una lectura real** | Gratis | Funciona |

- **Si Claude falla, está saturado o no hay señal, NO se usa otra IA.** Rosa sella igual, el acta queda con "lectura pendiente" y Claude la lee cuando llega a la central. Mientras tanto, la revisión es humana. **La elección no se detiene.**
- **Antecedentes y límites honestos:**
  - En México, un modelo **entrenado a propósito** con 3,77 millones de imágenes reales leyó casillas de hasta 3 dígitos de actas con **97,82 % de acierto**. Su sistema **rechaza los casos dudosos y los manda a revisión manual**, y su confianza está calibrada (Camargo-Rojas et al., 2026, resumen y sec. 5.3). Sus fallas típicas: un 4 cursivo que parece 9, **tachones de corrección** y tinta que se transparenta desde el reverso (sec. 6).
  - Los **OCR comerciales de 2022** (Azure y Google Vision) acertaron solo entre **35 % y 39 %** al leer dígitos manuscritos sueltos (Pant et al., 2022). Ese dato **no mide** modelos multimodales como Claude: muestra que una herramienta genérica puede fallar mucho.
  - En Indonesia, un error de lectura hizo que un 17 apareciera como 817 (Katadata, 2024).
  - **La confianza que Claude declara de sí mismo no está calibrada.** Por eso el umbral de 🟡 (0,8) es **provisional** hasta medirlo con 20–50 fotos reales.
  - Por eso **la IA es una alarma, no un juez**.
- **Alternativa o complemento:** el PREP de México usa **doble o triple digitación a ciegas**, hecha por personas distintas (Camargo-Rojas et al., sec. 3.1). En la mesa, un segundo miembro podría digitar sin ver lo que puso Rosa.

**🔧 Implementación**

| | |
|---|---|
| Algoritmo | Se le pide a Claude que devuelva JSON `{campo: {valor, confianza, tachon}}` → función pura `contrastar()`: 🔴 si el valor difiere, 🟡 si la confianza está bajo el umbral (0,8 provisional), si no se lee o si hay tachón, 🟢 si coincide. La tabla se recalcula sola cuando Rosa corrige. Si no hay respuesta: "lectura pendiente", sin otra IA. El umbral definitivo es el que mejor separa aciertos de errores en las fotos reales. |
| Tecnología | **Dentro de claude.ai:** capacidad `sample` de los artifacts, con imágenes. **Web propia:** API de Claude con imagen ([Claude, visión por API](https://platform.claude.com/docs/en/build-with-claude/vision)), con su modelo más avanzado, detrás de un Cloudflare Worker que guarda la clave, exige una petición firmada por una llave del padrón y limita las lecturas por mesa (arquitectura, sec. 5.4). La foto se reduce con `<canvas>` antes de enviarla (la huella siempre es del original). |
| Estado | ✅ Flujo en el prototipo · ⚠️ Ajustar el código: quitar Gemini y pedirle a `sample` el nivel más avanzado (hoy usa el nivel rápido) · ⏳ Medición del umbral: **mié 25** · ⏳ API propia: al implementar (de pago) |
| Justificación | [Camargo-Rojas et al., 2026](https://doi.org/10.3390/ai7070251) · [Pant et al., 2022](https://arxiv.org/pdf/2504.18948) (OCR comerciales de 2022, tabla de la sec. 3.5) · [Katadata, 2024](https://katadata.co.id/berita/nasional/cara-perbaiki-data-sirekap-agar-tak-beda-dengan-tps/65cdd9d65195e) |

### Paso 5 · El paquete sellado 📦
- Se sella **un solo paquete**: n.º de mesa + votos (los que decidió Rosa) + **huella de la foto del acta** + **huella de la foto del precinto del sobre lacrado de cédulas** + hora declarada + personeros presentes (sí/no).
- Firma el miembro de mesa. Si hay personeros, cofirman. Si no hay, el acta **sigue su camino** con la marca "sin personero".
- Es como engrapar la foto al acta y poner el sello encima de las dos hojas: no se puede cambiar una sin romper el sello.
- **¿Por qué la foto del precinto?** Desde la Ley 32243, las cédulas no se destruyen en la mesa: van a la ONPE en un **sobre lacrado** (art. 300). Fotografiar el precinto, con su número, permite comprobar al llegar que el sobre no se abrió. Es la idea que proponen Stark y Wagner (2012) para la cadena de custodia. Ese sobre es la base del sorteo del Paso 11.
- La lectura de la IA **no entra al acta**: se anota aparte en el cuaderno, enlazada a ella, con el modelo que leyó, el momento (antes o después del sello) y lo que decidió la persona.
- *Teoría:* la Ley 32243 (art. 291) ya permite entregar a los personeros copia del acta firmada física o digitalmente.

**🔧 Implementación**

| | |
|---|---|
| Algoritmo | Paquete `{mesa, votos, foto_sha256, precinto_sha256, precinto_numero, fecha_hora_declarada, personeros_presentes, reemplaza_a}` → **JSON canónico** (claves ordenadas, solo enteros y textos **ASCII**: los partidos van como códigos, por ejemplo `"P07"`, nunca con tildes) → SHA-256 → firma Ed25519 de la huella. Las cofirmas de los personeros se agregan a la lista de firmas. |
| Tecnología | Web Crypto: `digest` para la huella y **`sign` para firmar** (la llave no exportable no puede salir del navegador). @noble/curves solo para **verificar**. JSON canónico propio, un subconjunto de RFC 8785. Esa norma no normaliza Unicode (sec. 3.1), por eso se exige ASCII. |
| Estado | ✅ En el prototipo (firma del miembro de mesa) · ⏳ Cofirma de personeros y foto del precinto: **lun 23** |
| Justificación | [RFC 8032, Ed25519](https://www.rfc-editor.org/rfc/rfc8032.html) · [RFC 8785, JSON canónico](https://www.rfc-editor.org/rfc/rfc8785.pdf) · [Ley 32243, arts. 291 y 300](https://busquedas.elperuano.pe/dispositivo/NL/2361612-1) · [Stark y Wagner, 2012](https://www.stat.berkeley.edu/~stark/Preprints/evidenceVote12.pdf) (sec. II.B, precintos fotografiados) |

### Paso 6 · El acta viaja y llega a la central
- Se revisa que los sellos sean válidos y estén en el padrón, y que la foto no sea reciclada.
- Luego se anota en el **cuaderno de llegadas**, encadenado: cada renglón lleva la huella del anterior, así que si alguien borra uno, se nota. Las actas se anotan **de una en una** (ventanilla única), para que dos llegadas simultáneas no partan el cuaderno en dos.
- **Recibo firmado:** al anotar el acta, el servidor le devuelve a Rosa un **recibo firmado con la llave del servidor** (n.º de renglón + huella del acta + hora de llegada). Si después el acta no aparece o aparece cambiada, Rosa tiene una **prueba firmada** de que el servidor hizo trampa. Es la idea del recibo de Certificate Transparency (RFC 9162) y de la resolución de disputas de Ji y Chalkias (2021, sec. 4.2). La llave pública del servidor se publica en la primera raíz de la cadena y se ancla.
- **La foto se guarda por su huella**, en varias copias: el archivo se llama como su huella (`fotos/d256…jpg`) y queda en el servidor, en el celular de la mesa y en las copias públicas que descargan los partidos. Como el nombre **es** la huella, **sirve cualquier copia**: si alguien la cambia, deja de coincidir con la huella sellada.
- **Una copia más, independiente:** la ONPE publica las actas digitalizadas de cada mesa (Ley 32243, art. 291). Se comparan con nuestra foto y nuestros números.
- *Teoría:* registro que solo crece (RFC 9162; Crosby y Wallach, 2009); hash perceptual para fotos repetidas (Zauner, 2010).

**🔧 Implementación**

| | |
|---|---|
| Algoritmo | **Cuaderno encadenado:** `huella_renglón = SHA-256(JSON canónico de {número, tipo, huella_anterior, contenido})`; al llegar un acta se verifican la firma y el padrón, y se emite el recibo firmado. **Fotos recicladas:** primero SHA-256 (copia exacta). Luego se **endereza el acta** (se detectan sus 4 esquinas y se corrige la perspectiva, como Pant et al. con sus formularios), se recorta la zona escrita a mano y se calcula el hash perceptual, comparado por distancia de Hamming con un umbral medido con fotos reales. **Por qué enderezar:** ninguna de las funciones que probó Zauner resiste una rotación de 5° (sec. 6.3.4). Él recomienda combinar una función rápida y robusta con otra que distinga mejor (sec. 6.4). |
| Tecnología | Servidor: Durable Object como ventanilla única + SQLite/D1 con un *trigger* que bloquea UPDATE y DELETE. Fotos: [imagehash (Python)](https://github.com/JohannesBuchner/imagehash) (`average_hash` como filtro rápido y `phash` para confirmar). |
| Fotos guardadas | **Almacenamiento direccionado por contenido:** nombre del archivo = SHA-256 de la foto. Dos **tablas hash**: `Mesas` (n.º de mesa → paquete firmado, que incluye `foto_sha256`) y `Fotos` (huella → lugares donde está guardada). Búsqueda en O(1). **Prototipo:** carpeta `fotos/` en el repositorio de GitHub; cada `git clone` de un partido es una copia completa (sirve para un piloto, no para 90 000 fotos: [GitHub, archivos grandes](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)). **A gran escala:** IPFS (ver mejoras futuras). |
| Estado | ✅ Cadena local en el prototipo · ⏳ Servidor, recibos y fotos por huella: **lun 23** · ⏳ Fotos recicladas: **mié 25** |
| Justificación | [Haber y Stornetta, 1991](https://link.springer.com/content/pdf/10.1007/bf00196791.pdf) (encadenar huellas) · [Crosby y Wallach, 2009](https://static.usenix.org/event/sec09/tech/full_papers/crosby.pdf) · [RFC 9162](https://www.rfc-editor.org/rfc/rfc9162.pdf) · [Ji y Chalkias, 2021](https://eprint.iacr.org/2021/1350.pdf) (sec. 4.2) · [Zauner, 2010, hash perceptual](https://phash.org/docs/pubs/thesis_zauner.pdf) · [Pant et al., 2022](https://arxiv.org/pdf/2504.18948) · [Ley 32243, art. 291](https://busquedas.elperuano.pe/dispositivo/NL/2361612-1) |

### Paso 7 · El partido ausente vigila a distancia 👀
- El Partido Río no estuvo en la mesa, pero después revisa en el verificador la foto sellada y los números.
- Puede **respaldar u objetar** el acta, y la objeción queda registrada y firmada.
- **La foto sellada hace de testigo cuando falta el personero.**
- *Teoría:* hacer público el rastro de auditoría genera confianza, siempre que no se rompa el secreto del voto. Que un registro sea público dice **quién puede leerlo**, pero no **qué es auténtico**: eso lo prueban las firmas digitales (Rivest y Virza, 2016, sec. 1.7).

**🔧 Implementación**

| | |
|---|---|
| Algoritmo | Vista del verificador por mesa (foto + números + firmas). La objeción o el respaldo del partido es un **renglón firmado** con su llave del padrón, enlazado a la huella del acta. |
| Tecnología | La misma página del verificador (JavaScript) + Ed25519. |
| Estado | ⏳ **mar 24** |
| Justificación | [Rivest y Virza, 2016](https://people.csail.mit.edu/rivest/pubs/RV16.pdf) · [Ley 32243, art. 291](https://busquedas.elperuano.pe/dispositivo/NL/2361612-1) |

### Paso 8 · El tablero de resultados ⭐
- Cada mesa tiene su casillero fijo. Las actas se juntan de dos en dos, como en un torneo, y en cada cruce se **suman los votos**.
- La raíz resume todas las actas y certifica los totales nacionales. Con unas 100 000 mesas, el torneo tiene 17 rondas.
- **La app de cada mesa comprueba sola que su acta esté en el tablero.** Cuantas más mesas lo hagan, menos lugar queda para esconder una trampa (Ji y Chalkias, 2021, sec. 5).
- **Qué es nuestro y qué no:** el árbol de Merkle (Merkle, 1990), la idea de guardar datos agregados en sus nodos (Crosby y Wallach, 2009, sec. 4) y el árbol con sumas con su corrección (Maxwell, corregido por Hu, Zhang y Guo, 2019) **ya existían**. **Nuestro aporte es aplicarlos al conteo electoral**, con un casillero fijo por mesa y sin datos privados, de modo que cualquiera pueda recalcular el total nacional.
- *Teoría:* hay que comprobar que los números sumen, porque coincidir con un conteo a mano no garantiza que la suma esté bien hecha (Stark, 2009, CAST, nota 1).

**🔧 Implementación**

| | |
|---|---|
| Algoritmo | **Árbol de Merkle con sumas, de casilleros fijos:** 2¹⁷ = 131 072 casilleros. Hoja = `SHA-256(0x00 ‖ n.º_casillero ‖ huella_acta ‖ votos)`: el **número de casillero va dentro de la hoja**, para que nadie pueda poner un acta válida en el casillero de otra mesa. Nodo = `SHA-256(0x01 ‖ huella_izq ‖ huella_der ‖ sumas_izq ‖ sumas_der)`, con las sumas de **los dos hijos por separado** (Solución 2 de Hu et al., sec. 3.2) y solo enteros ≥ 0. **Vacíos iguales por nivel**, como en los árboles de Merkle dispersos: vacío del nivel 0 = `SHA-256(0x02)`; vacío del nivel k = nodo de dos vacíos del nivel k−1 con sumas 0. Son 18 valores fijos y **solo se guardan los nodos con al menos un acta**, así no hay que construir 262 143 nodos desde el inicio. La posición queda protegida porque la hoja llena lleva su casillero y porque la prueba baja a izquierda o derecha según los bits del casillero; además, el verificador comprueba que la mesa del paquete corresponda al casillero. Construir: O(n); actualizar una mesa: O(log n); probar que un acta está: O(log n), unas 17 huellas con sus sumas. |
| ⚠️ Pendiente | **Revisar la numeración real de las mesas de la ONPE.** Si sus números (6 dígitos, por ejemplo 045123) pasan de 131 071, se publica una tabla `mesa → casillero` firmada, o se usan más niveles (2²⁰ = 1 048 576 casilleros, 20 rondas). |
| Tecnología | JavaScript propio (lo usan el servidor, el verificador y el auditor). El Merkle en Python del repo, adaptado a sumas y casilleros fijos, sirve como **segunda implementación**: las dos deben dar la misma raíz. Pruebas automáticas propias. |
| Estado | ⏳ **dom 22 (tarde)** |
| Justificación | [Merkle, 1990](http://www.merkle.com/papers/Certified1979.pdf) (el enlace original ya no responde; copia del autor en [ralphmerkle.com](https://www.ralphmerkle.com/papers/Certified1979.pdf)) · [Crosby y Wallach, 2009](https://static.usenix.org/event/sec09/tech/full_papers/crosby.pdf) (sec. 4) · [Hu, Zhang y Guo, 2019](https://eprint.iacr.org/2018/1139.pdf) · [Ji y Chalkias, 2021](https://eprint.iacr.org/2021/1350.pdf) · [Stark, 2009, CAST](https://www.stat.berkeley.edu/~stark/Preprints/cast09.pdf) · [Melara et al., 2015, CONIKS](https://eprint.iacr.org/2014/1004.pdf) · [transparency-dev/merkle, vectores de prueba](https://pkg.go.dev/github.com/transparency-dev/merkle/testonly) (sirven para probar el cuaderno, no el tablero con sumas) |

### Paso 9 · Los guardianes: el periódico, el notario Bitcoin y el auditor continuo
**Por qué hacen falta dos cosas, y no una.** Un sello de fecha prueba **cuándo** existía una raíz, pero no que haya **una sola**. Es como un notario que sella cualquier documento que le lleven: si el servidor le lleva dos versiones, sella las dos. Con OpenTimestamps pasa exactamente eso: en Bitcoin solo queda una raíz que junta las huellas de muchas personas, y nuestra raíz solo la ve quien tiene el archivo `.ots`. Si se usara solo el sello, el servidor podría darle una raíz a los partidos y otra a los ciudadanos, con los dos sellos válidos. RFC 9162 reconoce este problema de "vistas distintas" (sec. 1). Por eso UNICOM usa:

- **El periódico (publicación única y replicada).** Cada raíz se publica en **un solo lugar que todos copian**: un commit en el repositorio de GitHub, que cada partido clona y vigila. Además, **cada raíz incluye la huella de la raíz anterior**, como CONIKS (sec. 3.3), y queda **una sola cadena** que no se puede bifurcar sin que se note. Es lo mismo que hacían Haber y Stornetta cuando publicaban huellas en un periódico.
  - **Ojo:** el dueño del repositorio podría reescribir su historial. Por eso la rama principal se protege contra reescrituras y, sobre todo, **cada auditor guarda su propio clon** y alerta si la historia nueva no continúa a la que ya tenía.
- **El notario Bitcoin (la fecha).** Cada cierto tiempo, la raíz se registra en Bitcoin mediante OpenTimestamps. Eso prueba que **esa raíz ya existía en esa fecha**, y nadie, ni siquiera nosotros, puede fabricarla después y hacerla pasar por antigua. Cualquiera puede comprobarlo **sin depender de nuestro servidor**. No usamos Bitcoin para votar ni para dinero: solo como notario. Park et al. (2021) advierten que una blockchain solo sirve como tablón público. Por eso aquí cumple un papel acotado: sellar la fecha.
- **Juntos cierran las dos puertas:** el periódico prueba que hay **una sola** raíz y Bitcoin prueba **desde cuándo** existe.
- **El auditor continuo.** Es un programa verificador **independiente** que revisa una y otra vez que todo UNICOM siga íntegro:
  1. que el cuaderno **solo crezca** y que ninguna acta anterior haya cambiado;
  2. que cada **firma Ed25519** sea válida y su llave esté en el padrón;
  3. que la **huella de cada foto** coincida con la que se selló;
  4. que las **sumas del tablero** cuadren en cada cruce, hasta el total nacional;
  5. que la **cadena de raíces** no tenga saltos, que la raíz publicada coincida con la anclada en Bitcoin y que **coincida con la que vieron los otros auditores**;
  6. que cada **recibo** entregado a una mesa corresponda a un renglón del cuaderno;
  7. que la **historia del repositorio** continúe a la que ya tenía (nadie la reescribió).
- **El auditor guarda una copia del árbol completo cada vez que se ancla una raíz**, porque en Bitcoin solo queda la raíz. El detective (Paso 10) necesita esa copia.
- **Ojo: la raíz cambia de forma legítima** cada vez que llega un acta nueva. Por eso el auditor **no** alerta porque la raíz cambió. Alerta solo ante una **inconsistencia**: una firma rota, una foto que no cuadra, una suma mal hecha, un renglón alterado o borrado, un salto en la cadena de raíces, **dos raíces distintas para el mismo momento** o un historial reescrito.
- Usa solo datos públicos y el mismo código que el verificador de Juan (Paso 12). Lo pueden correr los partidos, una universidad o cualquier ciudadano, **sin confiar en nuestro servidor**. El auditor que corre en nuestro GitHub Actions es nuestro; los **independientes** son los que corren otros en sus propias computadoras.
  - *Teoría:* los registros que solo crecen prevén **monitores** externos que revisan cada raíz nueva y su consistencia con las anteriores (RFC 9162, secs. 8.2 y 8.3); verificar sin confiar en el programa de quien maneja el sistema es la **independencia del software** (Rivest y Virza, 2016).

**🔧 Implementación**

| | |
|---|---|
| Algoritmo | **Publicación:** `raíz_publicada = {número, raíz_tablero, huella_cuaderno, huella_raíz_anterior, fecha}` firmada con la llave del servidor → commit en `raices/` del repositorio. La primera (`0000-genesis.json`) contiene la llave pública del servidor. **Notario:** `ots stamp(huella de raíz_publicada)` → archivo `.ots` "pendiente"; unas horas después, `upgrade` lo completa con el bloque de Bitcoin (el sello queda firme tras unas 5 confirmaciones, alrededor de una hora, según Gipp et al., 2015); la verificación comprueba la ruta de huellas hasta la raíz de Merkle del bloque. **Auditor:** lee solo lo nuevo desde los volcados públicos y revisa (1) la cadena del cuaderno; (2) las firmas y el padrón; (3) las huellas de las fotos; (4) las sumas, recalculando el tablero; (5) la cadena de raíces, la raíz frente al `.ots` y frente a lo que publicaron los otros auditores; (6) los recibos; (7) que la historia del repositorio continúe. Guarda una copia de cada árbol anclado. Alerta solo ante inconsistencias. |
| Tecnología | Publicación: commits en el repositorio de GitHub, con la rama principal protegida, que los partidos clonan. Anclaje con el cliente `ots` en Python (crea sellos sin nodo propio; **para verificar necesita un nodo Bitcoin local**). Por eso la verificación se hace con [javascript-opentimestamps](https://github.com/opentimestamps/javascript-opentimestamps) y los encabezados de bloque de la [API de mempool.space](https://mempool.space/docs/api/rest); esa librería es antigua: probarla el primer día, y si falla, un auditor corre un nodo podado. Auditor: script en Node con el **mismo código del verificador**, programado cada 5 minutos con GitHub Actions o corriendo en la laptop de un partido; lee volcados publicados en R2 (descarga gratuita) y publica la última raíz que vio para que los demás comparen. |
| Estado | ⏳ Publicación y notario: **lun 23** (primer anclaje de noche) · ⏳ Auditor: **mar 24** |
| Justificación | [Melara et al., 2015, CONIKS](https://eprint.iacr.org/2014/1004.pdf) (sec. 3.3, cadena de raíces) · [RFC 9162](https://www.rfc-editor.org/rfc/rfc9162.pdf) (sec. 1, vistas distintas; secs. 8.2 y 8.3, monitores) · [Haber y Stornetta, 1991](https://link.springer.com/content/pdf/10.1007/bf00196791.pdf) · [Gipp et al., 2015](https://arxiv.org/pdf/1502.04015) (OriginStamp: la misma idea de anclar huellas en Bitcoin) · [OpenTimestamps](https://opentimestamps.org) · [Cliente `ots`](https://github.com/opentimestamps/opentimestamps-client) · [Park et al., 2021](https://people.csail.mit.edu/rivest/pubs/PSNR20.pdf) (sec. 3) · [Rivest y Virza, 2016](https://people.csail.mit.edu/rivest/pubs/RV16.pdf) |

### Paso 10 · El detective 🔍
- Alguien cambia Sol 120 → 150 directamente en el servidor. Puede ser un **hacker externo** o un **administrador interno corrupto**: el diseño asume desde el inicio que el servidor **puede ser comprometido**.
- El auditor continuo detecta que las actas ya no reconstruyen la raíz publicada y anclada, y lanza la alerta.
- El detective toma **la copia del árbol anclado que guardó el auditor**, la compara con el árbol actual y baja 17 escalones hasta la mesa 045123. Ahí la trampa queda probada dos veces:
  1. **Prueba matemática:** la **firma digital de Rosa ya no es válida**, porque Rosa firmó un paquete que decía 120. Nadie puede rehacer esa firma sin su llave privada.
  2. **Prueba visual:** se busca la foto **por su huella** en cualquier copia, se comprueba que su huella sea la sellada y se muestra **lado a lado**:

| Foto original (huella verificada) | Paquete firmado por Rosa | Lo que dice el servidor ahora |
|---|---|---|
| Escrito a mano: **120** | **120** (firma válida) | **150** (no coincide: alterado) |

- **Nota honesta:** en este caso, la firma de Rosa ya delata el cambio por sí sola. El árbol aporta tres cosas más: encontrar rápido **qué** cambió, probar **contra qué versión anclada**, y atrapar lo que la firma no atrapa, como un acta **borrada** o **reemplazada** por otra con firma válida.
- Si el atacante también editó la foto del servidor, su huella no coincide y se usa otra copia. Si la borró, igual queda la prueba matemática de la firma, más las otras copias de la foto, el recibo de Rosa y el acta de papel.
- *Teoría:* comparación por subárboles (DeCandia et al., 2007, Dynamo, sec. 4.7); firma digital Ed25519 (RFC 8032).

**🔧 Implementación**

| | |
|---|---|
| Algoritmo | **Merkle-diff:** se compara el árbol actual con la copia del árbol anclado; donde las huellas difieren se baja por ese hijo (recursivo). O(k·log n) para k actas alteradas: unos 17 niveles por acta. En la hoja encontrada: (1) `verify` Ed25519 de la firma de Rosa sobre el paquete actual → falla; (2) se muestra la foto, cuya huella coincide con la sellada. |
| Ver la foto | Cadena de búsqueda: detective → n.º de mesa (O(log n)) → tabla `Mesas` → `foto_sha256` (O(1)) → tabla `Fotos` → descargar de cualquier copia (O(1)) → `SHA-256(foto) == foto_sha256` → vista lado a lado (foto · paquete firmado · servidor). |
| Tecnología | JavaScript propio, sobre el mismo árbol del Paso 8. |
| Estado | ⏳ **dom 22 (tarde)**, junto con el tablero |
| Justificación | [DeCandia et al., 2007, Dynamo](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) · [RFC 8032, Ed25519](https://www.rfc-editor.org/rfc/rfc8032.html) |

### Paso 11 · Lo que la huella no ve: dos carriles que no se mezclan
- Si toda la mesa escribe un número falso **en el papel**, la foto lo muestra igual y la IA dice 🟢. La huella y la IA atrapan alteraciones y **errores de digitación**, no actas falsas desde el origen.
- **Comparar acta contra acta tampoco basta:** el *cotejo* del JNE compara dos ejemplares de la misma acta (reglamento citado en la Res. 1052-2026-JNE, art. 5.m). Si la mesa escribió el mismo número falso en todos los ejemplares, coinciden. **Lo único que lo atrapa es mirar las cédulas.**
- **Las cédulas existen:** desde la Ley 32243, se guardan en un **sobre lacrado** que custodia la ONPE durante al menos 90 días (art. 300).
- Por eso hay dos carriles **independientes**:

| | **Carril A · Lista de prioridad** (revisión dirigida) | **Carril B · Sorteo al azar** (auditoría) |
|---|---|---|
| **Cuándo corre** | En paralelo, apenas llegan las actas | Al cerrar el tablero |
| **Sobre qué** | Las mesas con señales: anomalías estadísticas, marcas 🔴/🟡 y "sin personero" | **TODAS** las mesas, incluidas las 🟢, y dentro de ellas **cédulas del sobre lacrado** |
| **Cómo elige** | Sube arriba las mesas con anomalías estadísticas (Klimek et al., 2012), las marcadas 🔴/🟡 por la IA y las que salieron "sin personero" | Azar que nadie controla: dados + drand + bloque de Bitcoin (Lindeman y Stark, 2012) |
| **Para qué** | Que observadores y partidos sepan **dónde mirar primero**. Señala, nunca acusa | Atrapar actas **falsificadas desde el papel**, comparando cédulas reales con el subtotal firmado de su mesa |

- **Regla de oro:** la lista de prioridad **nunca altera ni condiciona** el sorteo. El Carril B no sabe qué dice el Carril A. Por eso un acta 🟢, sin anomalías y con personeros, puede salir sorteada igual. Si la lista influyera en el sorteo, quien conozca sus reglas podría esconder su trampa en las actas que nunca se revisan.
- **"Señala, nunca acusa" tiene respaldo del JNE:** la validez de un acta no se decide con comparaciones porcentuales ni con proyecciones estadísticas (Res. 1052-2026-JNE, punto 2.8). Y las anomalías también pueden venir del voto estratégico normal (Hicken y Mebane).
- **Límite legal honesto:** el JNE solo permite el **recuento** de votos en los casos que fija la ley (Res. 1052-2026-JNE, puntos 2.9 a 2.11). Por eso UNICOM propone el Carril B como **auditoría de control o piloto**: mide si el resultado es confiable y, si encuentra diferencias, aporta evidencia, pero **no cambia resultados por sí mismo**.

**🔧 Implementación**

| | |
|---|---|
| Algoritmo · Carril A | Puntaje de prioridad por mesa, que solo ordena y no acusa. **Huella participación-voto:** histograma 2D de participación contra porcentaje de votos (Klimek et al., fig. 1). **Último dígito** (chi-cuadrado): **solo en conteos de 2 dígitos o más**, porque la prueba no vale cuando hay muchos números muy pequeños (Beber y Scacco, sec. 2); se agrega la prueba de **pares de dígitos**. **Porcentajes enteros:** se excluyen las mesas de menos de 100 electores y se compara contra una **simulación de Monte Carlo**, porque en mesas chicas aparecen por azar (Kobak et al., sec. 2). Más las marcas 🔴/🟡 y "sin personero". **No se usa la ley de Benford** (Deckert et al.). |
| Algoritmo · Carril B | **Semilla** = `SHA-256(dados ‖ firma de drand de la ronda R ‖ hash del bloque de Bitcoin a la altura H)`, con R y H anunciados **antes** de cerrar el tablero, y con los subtotales ya publicados y anclados. El SHA-256 también sirve para "emparejar" el azar del bloque, que no es uniforme (Bonneau et al.). Se **verifica la firma de drand** con su llave pública. **Muestreo reproducible:** `SHA-256(semilla ‖ i) mod N` (método de `sampler.py` de Rivest) sobre **todas** las mesas, y luego sobre cédulas dentro de cada sobre sorteado. **Método de auditoría:** ONEAudit (Stark, 2023) permite una auditoría de riesgo limitado usando **solo el subtotal firmado de cada mesa**, sacando cédulas sueltas sin contar mesas enteras. El tamaño de la muestra depende del **margen**: en el ejemplo de Lindeman y Stark, unas 120 cédulas si el ganador tiene 60 %, 480 si tiene 55 % y 3 860 si tiene 52 % (sec. III). Antes de abrir un sobre se compara su precinto con la foto sellada del Paso 5. |
| Tecnología | A: Python con numpy, scipy y pandas sobre los datos por mesa de la ONPE. B: JavaScript en el verificador · [drand-client (JS)](https://github.com/drand/drand-client) · [API de mempool.space](https://mempool.space/docs/api/rest) (hash del bloque) · Python para el cálculo de ONEAudit. |
| Estado | ⏳ Carril B: **mar 24** (sorteo) y **mié 25** (cálculo de la muestra) · ⏳ Carril A: **mié 25** |
| Justificación | A: [Klimek et al., 2012](https://arxiv.org/pdf/1201.3087) · [Beber y Scacco, 2012](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/AD86EEBC2F199E2C8A2FD36BD3799DF9/S1047198700013103a.pdf/what-the-numbers-say-a-digit-based-test-for-election-fraud.pdf) · [Kobak et al., 2016](https://arxiv.org/pdf/1410.6059) · prudencia: [Deckert et al., 2011](https://core-cms.cambridgecore.org/core/services/aop-cambridge-core/content/view/3B1D64E822371C461AF3C61CE91AAF6D/S1047198700012808a.pdf/benfords-law-and-the-detection-of-election-fraud.pdf), [Hicken y Mebane, guía de forense electoral](https://www.iie.org/wp-content/uploads/2023/01/UM-Election-Forensics-Guide-FINAL.pdf), [Res. 1052-2026-JNE](https://busquedas.elperuano.pe/dispositivo/NL/2515273-1) (punto 2.8). B: [Ley 32243, art. 300](https://busquedas.elperuano.pe/dispositivo/NL/2361612-1) · [Stark, 2023, ONEAudit](https://arxiv.org/pdf/2303.03335) · [Lindeman y Stark, 2012](https://www.stat.berkeley.edu/~stark/Preprints/gentle12.pdf) · [Stark, 2009, CAST](https://www.stat.berkeley.edu/~stark/Preprints/cast09.pdf) · [Orange County, semilla con dados](https://ocvote.gov/results/risk-limiting-audit/risk-limiting-audit-random-seed) · [Rivest, sampler.py](https://people.csail.mit.edu/rivest/sampler.py) (ver también sus [casos de prueba públicos](https://github.com/nealmcb/rivest-sampler-tests)) · [Rivest, 2008](https://people.csail.mit.edu/rivest/pubs/Riv08a.pdf) (antecedente: cada mesa puede comprobar si salió sorteada) · [Stark, muestreo con SHA-256](https://www.stat.berkeley.edu/~stark/Java/Html/sha256Rand.htm) · [Bonneau, Clark y Goldfeder, 2015](https://eprint.iacr.org/2015/1015.pdf) · [drand](https://pkg.go.dev/github.com/drand/drand/v2) · [Boneh, Lynn y Shacham, 2001](https://www.iacr.org/archive/asiacrypt2001/22480516.pdf) (firma BLS de drand) · [Res. 1052-2026-JNE](https://busquedas.elperuano.pe/dispositivo/NL/2515273-1) (cotejo y límites del recuento) |

### Paso 12 · Juan lo comprueba desde su celular ✅
- Su celular revisa los sellos, que el acta está en el tablero, que las sumas cuadran y que la raíz es la publicada y la registrada en Bitcoin.
- *Teoría:* independencia del software (Rivest y Virza, 2016). Confiar en el código fuente no basta si no se puede comprobar que lo que corre es ese código (Lamb y Zacchiroli, 2022).

**🔧 Implementación**

| | |
|---|---|
| Algoritmo | En el celular de Juan, sin confiar en el servidor: SHA-256 de la foto → `verify` Ed25519 + padrón → prueba de inclusión con sumas (unas 17 huellas) hasta la raíz → la raíz frente a la publicada en el repositorio y al `.ots` de Bitcoin. Los datos se leen de GitHub Pages y de R2, no del Worker. |
| Tecnología | Página estática en [GitHub Pages](https://docs.github.com/en/pages) (JavaScript + Web Crypto + @noble/curves + javascript-opentimestamps). **Para que Juan sepa que corre el código publicado:** (1) **el verificador se ofrece para descargar y usar sin internet**, y la huella de ese archivo se publica en el repositorio y se ancla en Bitcoin: Juan (o un partido) la comprueba una vez; (2) si el JavaScript se empaqueta, el empaquetado debe ser **reproducible**; (3) los scripts que se cargan desde **otro servidor** llevan [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity). Ojo: Subresource Integrity solo no basta, porque quien cambia el HTML también puede cambiar la huella escrita en él. |
| Estado | ⏳ **mar 24** |
| Justificación | [Rivest y Virza, 2016](https://people.csail.mit.edu/rivest/pubs/RV16.pdf) · [Lamb y Zacchiroli, 2022](https://arxiv.org/pdf/2104.06020) |

---

## Modelo de amenazas (preguntas de Park et al., 2021, sec. 4)

| Pregunta | Respuesta de UNICOM |
|---|---|
| ¿Quiénes participan? | Miembros de mesa, personeros, partidos, ONPE/ODPE, JEE/JNE, operadores del servidor, auditores (partidos, universidad), ciudadanos. |
| ¿Qué pasa si el **celular de Rosa** tiene malware y firma números distintos de los que muestra? | Lo atrapan la foto sellada (la IA y el partido la ven), el acta de papel y el Carril B (cédulas). |
| ¿Y si el **servidor** está comprometido? | Lo atrapan las firmas, el recibo de Rosa, la cadena de raíces publicada, el anclaje en Bitcoin y el auditor independiente (Pasos 6, 9 y 10). |
| ¿Y si se filtra la **llave del servidor**? | Se rota con un renglón firmado, publicado y anclado; los recibos y raíces anteriores siguen verificándose con la llave vieja hasta ese renglón (arquitectura, sec. 5.3). |
| ¿Y si el servidor muestra **dos versiones**? | La publicación única replicada y la comparación entre auditores (Paso 9). |
| ¿Y si el dueño **reescribe el historial** del repositorio? | Los clones de los auditores y de los partidos lo delatan, y las raíces siguen ancladas en Bitcoin (Paso 9). |
| ¿Y si **toda una mesa** se pone de acuerdo para falsear el acta? | Solo lo atrapa el Carril B, mirando cédulas del sobre lacrado (Paso 11). Es el límite reconocido del sistema. |
| ¿Y si alguien manipula el **sorteo**? | Tendría que controlar a la vez los dados, drand y un bloque de Bitcoin. |
| ¿UNICOM **previene** o **detecta**? | Detecta y deja evidencia. No impide escribir un número falso, pero hace que se note. |
| ¿Quién puede verificar? | Cualquiera, con datos públicos y código abierto (Pasos 9 y 12). |
| ¿Se rompe el secreto del voto? | No: UNICOM nunca toca cédulas marcadas con identidad; trabaja con actas (datos ya públicos por el art. 291) y, en el Carril B, con cédulas anónimas. |

---

## ¿Quién atrapa a quién?

| Si alguien o algo… | Lo atrapa… |
|---|---|
| Suma mal en la mesa | La revisión de sumas, con las categorías del reglamento (avisa) |
| Digita mal un número | La IA lectora **antes de sellar** (🔴) + la corrección de una persona |
| La IA lee mal | Una persona revisa el papel; la IA nunca cambia el acta |
| La IA falla, se satura o no hay señal | Se sella igual: "lectura pendiente", Claude lee en la central y mientras tanto revisa una persona (no se cambia de IA) |
| Alguien intenta gastar los créditos de la IA | El candado del Worker: solo peticiones firmadas por el padrón y un límite por mesa |
| Cambia la foto después | La huella de la foto, sellada dentro del paquete |
| Borra la foto del servidor | Las otras copias, buscadas por su huella (celular, partidos, repositorio, actas de la ONPE) + la firma de Rosa + el acta de papel |
| No hay personeros en la mesa | La foto sellada + la revisión a distancia del partido |
| Inventa un firmante | El padrón de sellos (y cada miembro de mesa vigila su propia llave) |
| Cambia un acta en el camino | La huella + la firma + el detective |
| El servidor "pierde" un acta | El **recibo firmado** que tiene Rosa |
| Un hacker o un administrador corrupto cambia un acta en el servidor | El auditor continuo + el detective: la firma de Rosa se rompe (prueba matemática) y la foto sellada muestra el número real (prueba visual) |
| Cambia la suma nacional | El tablero que suma en cada cruce + el auditor, que recalcula las sumas |
| Reescribe o borra el historial | La cadena de raíces publicada + los clones de los auditores + el notario Bitcoin |
| Muestra una versión a unos y otra a otros | La **publicación única replicada** + la comparación entre auditores |
| Abre o cambia el sobre de cédulas | La foto sellada del **precinto** |
| Arregla el sorteo | Dados + drand + Bitcoin |
| Escribe un número falso desde la mesa | Carril B: cédulas del sobre lacrado contra el subtotal firmado (el Carril A solo indica dónde mirar primero) |

---

## Pila tecnológica en una mirada

| Capa | Tecnología | Por qué |
|---|---|---|
| App de mesa, verificador, tablero, detective y auditor | **JavaScript** en el navegador o en Node (un solo código para todo) | El verificador corre en el celular de cualquiera; reutilizar el código evita que dos versiones se contradigan |
| Huellas y firmas | **Web Crypto API** (SHA-256, generar llaves y **firmar**) + **@noble/curves** para **verificar** Ed25519 en todos lados | Nada de criptografía casera, y una sola librería para verificar, así no hay discrepancias |
| Servidor | **Cloudflare Workers** + **Durable Object** (ventanilla única) + D1 + R2, en plan gratuito como **piloto** | Mismo JavaScript que el núcleo; la ventanilla única evita que dos actas simultáneas partan el cuaderno |
| Lector de IA | **Claude** (`sample` dentro de claude.ai; su API en la web propia, con candado) | Un solo lector, la misma vara para todas las actas |
| Publicación de raíces | **Repositorio de GitHub** clonado por los partidos, con la rama principal protegida | El "periódico": una sola versión, que todos ven |
| Notario | **OpenTimestamps** (cliente `ots` en Python para anclar; javascript-opentimestamps + mempool.space para verificar) | La fecha, anclada gratis en Bitcoin |
| Azar del sorteo | Dados + **drand** + bloque de Bitcoin | Ninguna fuente controla sola el resultado |
| Estadística y mediciones | **Python** (numpy, scipy, pandas, imagehash) | Carril A, ONEAudit, error del lector y fotos recicladas |
| Publicación web | **GitHub Pages** + verificador descargable con huella anclada (+ Cloudflare Worker para la clave de la API) | Gratis, con https, y comprobable |
| Fotos | Archivos nombrados por su huella + tablas hash (`Mesas`, `Fotos`), en R2 y en el repositorio de GitHub (piloto) | Cualquier copia sirve y se verifica sola; IPFS a futuro |
| Segunda implementación del árbol | El Merkle en **Python** del repo, adaptado a sumas y casilleros fijos | Si las dos implementaciones dan la misma raíz, hay más evidencia de que el código está bien |

---

## Plan de trabajo (dom 22 → vie 27)

### ✅ Hecho
- **Prototipo de mesa** (`prototipo-lector`): foto con huella; revisión de sumas; paquete sellado con firma Ed25519 y marca "sin personero"; revisión con IA **antes de sellar**; sello sin esperar si no hay señal; cuaderno encadenado con la nota de la IA aparte.
- Probado de forma automática con el simulado y con respuestas imitadas (saturación, demora, lectura correcta). Publicado en claude.ai con Claude como lector.
- **Revisión de las 38 fuentes** (`REVISION_PAPERS_v5.md`) y este plan final, con su revisión 1.
- Repositorio clonado en la PC del autor, con los planes en `docs/` y las reglas del proyecto en `CLAUDE.md`.
- ⚠️ El código del prototipo todavía trae Gemini y el cambio automático de modelo: **hay que quitarlos** (el autor pidió no tocar el código por ahora).

### Pendiente, en orden
| Día | Programación | Documentos |
|---|---|---|
| **Dom 22 (tarde)** | Confirmar una lectura real completa con Claude en claude.ai (captura). **Núcleo + tablero con totales (vacíos por nivel, casillero dentro de la hoja) + cadena de raíces + detective + capa de almacén local** + pruebas automáticas | — |
| **Lun 23** | Padrón de sellos, vigilancia de la llave propia y reemplazo de llave. Ventanilla única + cuaderno en el servidor + **recibos firmados**. `revisarSumas()` con impugnados y art. 279. Foto del precinto en el paquete. Subir el prototipo a **GitHub Pages**. Probar el *trigger* en D1 y javascript-opentimestamps. **De noche:** génesis con la llave del servidor + primera raíz publicada + primer anclaje en OpenTimestamps | Objetivos y metodología del informe |
| **Mar 24** | **Verificador ciudadano** (descargable, con huella anclada) + **auditor continuo** (cadena de raíces, comparación entre auditores, copias de árboles, historial del repositorio) + **sorteo** (dados + drand verificado + bloque) + candado del lector de IA | Borrador del informe completo |
| **Mié 25** | Fotos recicladas (enderezar + hash perceptual) + Carril A corregido + cálculo de muestra ONEAudit + **mediciones**: error y umbral de Claude con 20–50 fotos reales, tiempos del árbol, ataques simulados | Resultados y conclusiones; **afiche** |
| **Jue 26** | Congelar el código; publicación y anclaje final | **Entregar el afiche**; presentación HTML 3D; grabar videos de respaldo; ensayo |
| **Vie 27** | Nada nuevo | Ensayo final → **exposición** |
| **Cuando el autor lo indique** | Ajustar el prototipo: quitar Gemini y el cambio de modelo; dejar Claude + simulado (solo demo) | — |
| **Al implementar** | Comprar créditos de la API de Claude, fijar un tope de gasto y conectar la web propia con su modelo más avanzado (con Cloudflare Worker) | Actualizar la tabla del lector |

### Decisiones
- ✅ **Lector:** **solo Claude**, su modelo más avanzado. No se cambia de IA; si falla, "lectura pendiente" + revisión humana. El simulado es solo para la demo.
- ✅ **Mesas sin personeros:** firma obligatoria del miembro de mesa; personeros opcionales.
- ✅ **Foto del acta y del precinto dentro del paquete sellado.**
- ✅ **Guardianes:** publicación única replicada + notario Bitcoin + auditor continuo. Se quitan los 3 testigos y el bot de Telegram.
- ✅ **Revisión en dos carriles:** lista de prioridad (A) y sorteo al azar sobre cédulas (B), separados. El B se propone como auditoría de control o piloto.
- ⏳ **Arquitectura revisión 1:** piloto en plan gratuito y ventanilla única con Durable Object. Falta tu confirmación.
- ⏳ **Lenguaje del resto:** JavaScript para el tablero, el detective, el verificador y el auditor; Python para la estadística y las mediciones. Falta tu confirmación.
- ⏳ **Rekor:** sí o no.
- ⏳ **IA estadística:** solo pruebas simples o también un modelo entrenado.
- ⏳ **Numeración de mesas:** confirmar con datos de la ONPE si alcanzan 2¹⁷ casilleros.
- ⏳ **Rahmadhani et al. (Indonesia, 77,89 %):** se quitó la cifra porque el plan no tenía su enlace. Se vuelve a poner solo si se consigue la fuente.

---

## Propuesta de mejora futura: el cuaderno como árbol de historia
*No se implementa en el prototipo actual.*
- Hoy el cuaderno es una **cadena**: para probar que no cambió, hay que revisarla entera. Crosby y Wallach (2009) muestran que un **árbol de historia** da pruebas pequeñas. En su ejemplo, 3 KB en lugar de 800 MB. Además, permite **pruebas de consistencia** entre dos versiones del cuaderno (RFC 9162, sec. 2.1.4).
- **Fuentes:** [Crosby y Wallach, 2009](https://static.usenix.org/event/sec09/tech/full_papers/crosby.pdf) · [RFC 9162](https://www.rfc-editor.org/rfc/rfc9162.pdf).

## Propuesta de mejora futura: resistencia a la computación cuántica
*No se implementa en el prototipo actual.*
- **Lo que ya resiste: los hashes (SHA-256).** Las huellas de las fotos, el cuaderno y el árbol con sumas dependen solo de SHA-256. El algoritmo de **Grover** acelera la búsqueda por fuerza bruta solo de forma cuadrática: la seguridad para encontrar una entrada que dé una huella dada baja de 256 a **128 bits**, que sigue considerándose segura.
- **Lo que sería vulnerable: las firmas Ed25519.** RFC 8032 (sec. 8.5) dice directamente que Ed25519 y Ed448 caerían ante una computadora cuántica. La base es el algoritmo de **Shor**, que resuelve el logaritmo discreto en tiempo polinomial. Hoy no existe una máquina capaz de hacerlo, pero una firma de hoy podría falsificarse en el futuro.
- **La mejora:** como la firma es una pieza separada del resto, se puede migrar a, o **combinar** Ed25519 con, firmas post-cuánticas estandarizadas por el NIST en 2024: **ML-DSA (FIPS 204)**, basada en retículos, o **SLH-DSA (FIPS 205)**, basada solo en hashes. En una firma combinada, el acta vale solo si **las dos** firmas son válidas. **Costo:** una firma ML-DSA-44 pesa 2 420 bytes y una SLH-DSA, entre 7 856 y 49 856 bytes; una Ed25519 pesa 64.
- **Nota sobre el anclaje:** la prueba de OpenTimestamps se apoya en SHA-256 y en la cadena de Bitcoin; cómo prepara Bitcoin sus propias firmas ante la computación cuántica es una cuestión de esa comunidad, no de UNICOM.
- **Fuentes:** [Grover, 1996](https://arxiv.org/pdf/quant-ph/9605043) · [Shor, 1995](https://arxiv.org/pdf/quant-ph/9508027) · [RFC 8032, sec. 8.5](https://www.rfc-editor.org/rfc/rfc8032.html) · [NIST FIPS 204, ML-DSA](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf) · [NIST FIPS 205, SLH-DSA](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.205.pdf) · librería candidata: [@noble/post-quantum](https://github.com/paulmillr/noble-post-quantum) (implementa ML-DSA y SLH-DSA, pero **todavía no tiene auditoría independiente**: evaluarla antes de usarla).

## Propuesta de mejora futura: fotos en una red distribuida (IPFS)
*No se implementa en el prototipo actual.*
- **El problema a escala nacional:** un repositorio de GitHub sirve para un piloto, pero no para unas 90 000 fotos en una elección real.
- **La mejora:** guardar las fotos en **IPFS**, una red donde cada archivo se pide **por su contenido** y no por el servidor donde está. Cualquier nodo que tenga la foto puede entregarla, y quien la recibe la verifica solo.
- **Ojo:** IPFS parte los archivos en bloques y los identifica con su propio formato (CID). **El CID de una foto no es igual a su SHA-256.** Por eso la tabla `Fotos` guarda la relación `foto_sha256 → CID`, y la verificación final sigue siendo `SHA-256(foto) == foto_sha256`.
- **Quién la guarda:** los partidos, las universidades o los observadores pueden "fijar" (*pin*) las fotos en sus propios nodos.
- **Fuentes:** [Benet, 2014, IPFS](https://arxiv.org/pdf/1407.3561) · [IPFS, direccionamiento por contenido](https://docs.ipfs.tech/concepts/content-addressing/).
