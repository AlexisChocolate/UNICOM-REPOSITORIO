# UNICOM · Plan final: arquitectura de implementación y despliegue
*22 de noviembre de 2026 · **revisión 1** (corrige los huecos encontrados en la revisión del mismo día). Reemplaza a `PLAN_v5_ARQUITECTURA.md` y complementa `PLAN_FINAL_HISTORIA.md` (los 13 pasos, su implementación y sus fuentes). Este documento define **cómo se separa, dónde se levanta y cómo se protege cada pieza**. Límites gratuitos de Cloudflare comprobados el 22/11/2026 en sus páginas oficiales.*

**Qué cambió en la revisión 1**
- **Ventanilla única:** todas las escrituras pasan por un Durable Object que atiende las actas de una en una (antes, dos actas simultáneas podían partir el cuaderno en dos).
- **Casilleros vacíos iguales por nivel:** así el árbol no necesita 262 000 nodos guardados desde el inicio.
- **Escala declarada:** el despliegue gratuito es un **piloto**; se calcula cuántas actas aguanta por día.
- **Candado del lector de IA**, **historia de la llave del servidor**, **protección del "periódico"** contra la reescritura del historial y **reemplazo de la llave de un miembro de mesa**.
- **Correcciones honestas:** Subresource Integrity solo no prueba qué código corre; el cliente Python de OpenTimestamps no verifica sin un nodo Bitcoin.
- **Capa de almacén** para que el plan B (laptop sin internet) use el mismo código.
- Se corrige el límite de D1: **500 MB por base de datos** en el plan gratuito (no 5 GB por base).
- Sección nueva con los cambios que esto impone a `PLAN_FINAL_HISTORIA.md` (ya aplicados en su revisión 1).

---

## 1. Separación en capas

```
                 ┌─────────── núcleo (JS compartido) ───────────┐
                 │ huellas · verificación de firmas (@noble/     │
                 │ curves) · JSON canónico · árbol con sumas ·   │
                 │ cadena de raíces · detective · sorteo         │
                 └───────┬──────────────┬──────────────┬─────────┘
                         │              │              │
 FRONTEND (web)      BACKEND (API)                AUDITORES CONTINUOS
 app de mesa,        Worker: recibe,              independientes: leen
 verificador,        verifica firmas,             volcados públicos (R2),
 vista del partido   llama a Claude      ──►      guardan copias de árboles
                         │                        y comparan raíces entre ellos
                         ▼                                 ▲
               VENTANILLA ÚNICA (Durable Object)           │
               atiende una acta a la vez: cuaderno,        │
               recibo firmado, árbol por partes            │
                         │                                 │
                         ▼                                 │
               BASE (D1) + FOTOS (R2) ── volcados ─────────┘
                         │
                         ▼
             PUBLICACIÓN DE RAÍCES (el "periódico")
             carpeta raices/ del repositorio, clonada por
             los partidos  ──►  anclaje en Bitcoin (OpenTimestamps)
```

- **Un solo núcleo:** la web, el backend y los auditores usan el mismo código para huellas, verificación y árbol. **Verificar** se hace con una sola librería (@noble/curves), porque librerías distintas pueden discrepar en casos raros (RFC 8032, sec. 8.8). **Firmar** lo hace cada dueño con su propia llave (ver sección 5.1).
- **Ventanilla única:** el cuaderno exige que cada renglón lleve la huella del anterior. Si dos actas llegaran a la vez y las dos leyeran el mismo "renglón anterior", el cuaderno se partiría en dos ramas, y lo mismo pasaría con el árbol. Un Durable Object es una instancia única en Cloudflare que procesa los pedidos **en fila**, de uno en uno: es la ventanilla con un solo cajero.
- **Auditores aparte y más de uno:** el backend puede ser hackeado (Paso 10), así que quien lo vigila no vive dentro de él. Si dos auditores ven raíces distintas para el mismo momento, esa es la prueba de que el servidor mostró dos versiones (Paso 9).
- **Periódico + notario:** la publicación en el repositorio prueba que hay **una sola** raíz; Bitcoin prueba **desde cuándo** existe.
- **Capa de almacén:** el núcleo y la API no llaman directamente a D1 ni a R2, sino a una pequeña interfaz (`guardarRenglon`, `leerNodo`, `guardarFoto`…). Hay dos implementaciones: Cloudflare (D1 + R2 + Durable Object) y local (SQLite + carpeta). Así el plan B usa exactamente el mismo código.

## 2. Estructura del repositorio (`AlexisChocolate/UNICOM-REPOSITORIO`)

```
UNICOM-REPOSITORIO/
├── nucleo/       JS: huellas, verificación, árbol, cadena de raíces, detective, sorteo
│                 + pruebas (vectores de RFC 8032)
├── almacen/      interfaz + dos implementaciones: cloudflare/ y local/
├── web/          (lo hace el chat, no Claude Code) mesa.html, verificador.html, partido.html (responsive)
│                 + verificador descargable para usar sin internet (con su huella publicada)
├── api/          Worker + Durable Object: recibir actas, recibos, cuaderno, tablero,
│                 lector de IA con candado, volcados, raíz firmada
├── base/         esquema.sql (tablas y bloqueo de cambios)
├── auditor/      script independiente (Node) + copias de árboles anclados
├── merkle-py/    segunda implementación del árbol en Python (debe dar la misma raíz)
├── analisis/     Python: Carril A, ONEAudit, error del lector, fotos recicladas
├── raices/       0000-genesis.json (llave pública del servidor) + una raíz por archivo + su .ots
├── fotos/        copia pública de las fotos del piloto, nombradas por su huella
├── docs/         planes del proyecto
└── .github/workflows/
                  pruebas.yml (en cada commit) · publicar-raiz.yml · completar-ots.yml
                  · copiar-fotos.yml · auditor.yml
```

## 3. Dónde se levanta (planes gratuitos)

| Capa | Servicio | Límite gratis (comprobado el 22/11/2026) | Enlace |
|---|---|---|---|
| Frontend | **GitHub Pages** | Gratis, con https | [Documentación de GitHub Pages](https://docs.github.com/en/pages) |
| Backend | **Cloudflare Workers** | 100 000 peticiones por día; 10 ms de CPU por petición (no cuenta el tiempo esperando respuestas de red); 50 subpeticiones por petición; 128 MB de memoria | [Precios de Workers](https://developers.cloudflare.com/workers/platform/pricing/) · [Límites de Workers](https://developers.cloudflare.com/workers/platform/limits/) |
| Ventanilla única | **Durable Objects** (con SQLite) | Disponibles en el plan gratuito solo con SQLite: 100 000 peticiones, 5 millones de filas leídas y 100 000 escritas por día; 5 GB en total | [Precios de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Base de datos | **Cloudflare D1** (SQLite) | **500 MB por base de datos** y 5 GB por cuenta; 5 millones de filas leídas y 100 000 escritas por día; 50 consultas por invocación (un `batch()` cuenta como una) | [Límites de D1](https://developers.cloudflare.com/d1/platform/limits/) |
| Fotos y volcados | **Cloudflare R2** + copia en GitHub (piloto) | 10 GB al mes; 1 millón de operaciones clase A y 10 millones clase B por mes; descarga sin costo | [Precios de R2](https://developers.cloudflare.com/r2/pricing/) · [GitHub, archivos grandes](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) |
| Publicación de raíces | **Repositorio de GitHub** (`raices/`) | Gratis | [Documentación de GitHub Pages](https://docs.github.com/en/pages) |
| Auditor | **GitHub Actions** (el nuestro) + laptops de partidos o de una universidad (los independientes) | Intervalo mínimo de 5 minutos; puede retrasarse cuando hay mucha carga | [Eventos que disparan flujos](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows) |
| Lector de IA | **API de Claude**, clave guardada como secreto del Worker | De pago (créditos al implementar) | [Claude, visión por API](https://platform.claude.com/docs/en/build-with-claude/vision) |
| Notario | **OpenTimestamps** + API de mempool.space | Gratis | [OpenTimestamps](https://opentimestamps.org) · [Cliente `ots`](https://github.com/opentimestamps/opentimestamps-client) · [API de mempool.space](https://mempool.space/docs/api/rest) |
| Análisis | **Python** (numpy, scipy, pandas, imagehash) | Local | [imagehash](https://github.com/JohannesBuchner/imagehash) |

> En el plan gratuito, si se pasa cualquiera de los límites del día, las operaciones siguientes de ese tipo **fallan con error** hasta que se reinician (00:00 UTC, 19:00 en Perú). Por eso la sección 3.1 calcula el presupuesto.

### 3.1 Presupuesto de un acta y escala del piloto
Cada acta que llega escribe aproximadamente:

| Qué | Filas |
|---|---|
| Renglón del cuaderno | 1 |
| Recibo firmado | 1 |
| Índice `actas` | 1 |
| Índice `fotos` | 1 |
| Nodos del árbol que cambian (17 niveles) | 17 |
| **Total** | **≈ 21** |

- Con 100 000 escrituras por día, el plan gratuito aguanta **unas 4 700 actas por día** (sin contar índices extra, lecturas de los auditores ni reintentos).
- **Una elección nacional (≈ 90 000 actas) no cabe en el plan gratuito**: serían ≈ 1,9 millones de escrituras en un día. Además, cada base de D1 tiene un tope de 500 MB.
- **Decisión:** el despliegue gratuito es un **piloto** (por ejemplo, hasta 1 000 mesas simuladas de Puno). Para escala nacional se pasa al plan de pago de Workers o a servidores propios de la ONPE. El diseño no cambia: solo cambia dónde corre.

### 3.2 Límites de tiempo y su solución
- **10 ms de CPU** alcanzan para verificar una firma, anotar un renglón, actualizar 17 nodos y firmar el recibo. **No** alcanzan para recalcular el árbol entero: el backend lo actualiza **por partes** (solo la rama que cambia, O(log n)). El recálculo completo lo hacen los **auditores**, que no tienen ese límite.
- **La espera a Claude no consume CPU:** el tiempo esperando la respuesta de la API no cuenta para los 10 ms.
- **Consultas:** las 17 actualizaciones del árbol se mandan juntas en un `batch()`, que cuenta como una sola consulta y se aplica completa o no se aplica.

## 4. El árbol: casilleros vacíos iguales por nivel
- **Antes:** `vacío = SHA-256(0x02 ‖ n.º_casillero)`. Cada vacío era distinto, así que había que calcular y guardar el árbol completo desde el inicio: 2¹⁸ − 1 = 262 143 nodos. Eso supera las 100 000 escrituras diarias y no cabe en 10 ms.
- **Ahora** (como en los árboles de Merkle dispersos):
  - vacío del nivel 0 = `SHA-256(0x02)`;
  - vacío del nivel k = `SHA-256(0x01 ‖ vacío_(k−1) ‖ vacío_(k−1) ‖ sumas 0 ‖ sumas 0)`.
  - Son 18 valores fijos que se calculan una vez y viven en el código. **Solo se guardan los nodos que tienen al menos un acta.**
- **¿Se pierde la protección de la posición? No.** La **hoja llena** sigue llevando el n.º de casillero (`SHA-256(0x00 ‖ n.º_casillero ‖ huella_acta ‖ votos)`). Además, la prueba de inclusión baja a la izquierda o a la derecha según los bits del n.º de casillero, y el verificador comprueba que el casillero corresponda a la mesa del paquete. Un acta válida no se puede mover al casillero de otra mesa.

## 5. Seguridad de cada pieza

### 5.1 Firmar y verificar (corrige una contradicción)
- La llave de Rosa se crea en **Web Crypto** como **no exportable**: no puede salir del navegador, ni siquiera para pasársela a otra librería.
- Por eso **Rosa firma con Web Crypto** (`crypto.subtle.sign("Ed25519", …)`), y **todos verifican con @noble/curves** (navegador, backend y auditor).
- **Plan B para celulares viejos** cuyo navegador no tenga Ed25519 en Web Crypto: la app lo detecta y avisa. En el piloto se usan celulares con un Chrome actual. No se usan llaves exportables.

### 5.2 Si Rosa pierde su llave
- Si borra los datos del navegador o cambia de celular, su llave desaparece.
- **Procedimiento:** se genera una llave nueva, y el partido (o la ONPE) firma un renglón `reemplazo_llave {mesa, llave_vieja, llave_nueva, motivo}`, que se anota en el cuaderno. Las actas firmadas antes con la llave vieja siguen siendo válidas.

### 5.3 La llave del servidor
- El servidor firma los **recibos** y las **raíces publicadas**. Su llave privada vive como secreto del Worker.
- **Dónde se publica su llave pública:** en el primer archivo de la cadena, `raices/0000-genesis.json`, que se ancla en Bitcoin como cualquier raíz. Así nadie puede cambiarla después sin que se note.
- **Si hay que cambiarla** (por ejemplo, porque se filtró): la llave vieja firma un renglón `rotacion_llave {llave_nueva, desde_renglon, motivo}`, que se publica y se ancla. Si la llave vieja ya no es confiable, el cambio lo firman también los auditores. Los recibos anteriores siguen verificándose con la llave vieja, hasta el renglón indicado.

### 5.4 Candado del lector de IA
El Worker que guarda la clave de Claude es una puerta abierta en internet: sin candado, cualquiera podría mandarle fotos y gastar los créditos.
- Solo atiende peticiones **firmadas con una llave del padrón** (un miembro de mesa) y con una hora reciente, para que no se pueda repetir una petición vieja.
- **Límite por mesa:** por ejemplo, 5 lecturas. Si se pasa, el acta queda en "lectura pendiente".
- **Tope de gasto** configurado en la consola de Anthropic.
- La web solo acepta llamadas desde el dominio de GitHub Pages (CORS).

### 5.5 El "periódico" contra la reescritura del historial
- El dueño del repositorio (el autor) **puede** reescribir el historial con un *force-push*. Por eso la publicación única solo funciona si **otros guardan su copia**.
- **Medidas:**
  1. Proteger la rama principal (prohibir *force-push* y borrado).
  2. Cada auditor guarda su propio clon y, antes de actualizar, comprueba que la historia nueva **continúe** a la que ya tenía. Si alguien la reescribió, alerta (nueva revisión 7 de la sección 7).
  3. Cada raíz lleva la huella de la anterior y queda anclada en Bitcoin: aunque se borre del repositorio, las copias y el anclaje la delatan.
- **Honestidad:** el auditor que corre en GitHub Actions es **nuestro**, no independiente. Los independientes son los de los partidos o de una universidad, en sus propias computadoras.

### 5.6 Qué prueba Subresource Integrity (corrección)
- Subresource Integrity hace que el navegador rechace un script si su huella no coincide con la escrita en el HTML. **Pero si un atacante cambia el HTML, también puede cambiar esa huella.** Por eso, solo, no prueba que Juan corre el código publicado.
- **Lo que sí lo prueba:** el **verificador descargable**, cuya huella se publica en el repositorio y se ancla en Bitcoin. Juan (o un partido) comprueba esa huella una vez y lo usa sin internet.
- Subresource Integrity se mantiene, pero solo para lo que sirve: proteger los scripts que se cargan desde otro servidor.

### 5.7 El bloqueo de la base de datos
- La tabla `cuaderno` lleva un *trigger* que rechaza UPDATE y DELETE. La documentación de D1 no lo dice explícitamente, así que **se prueba el primer día**.
- **Límite honesto:** el dueño de la cuenta de Cloudflare puede borrar el *trigger*. Protege contra errores del programa, **no contra un administrador**. Contra él están las firmas, los recibos, las raíces publicadas y el anclaje.

## 6. Base de datos

| Tabla | Qué guarda | Regla |
|---|---|---|
| `padron` | llaves públicas de miembros de mesa y personeros + reemplazos de llave | Solo se agrega |
| `cuaderno` | cada renglón: número, tipo, huella anterior, contenido, huella | **Solo se agrega** (*trigger*) · solo escribe la ventanilla única |
| `recibos` | n.º de renglón + huella del acta + hora de llegada + firma del servidor | Solo se agrega; una copia queda en el celular de la mesa |
| `actas` | n.º de mesa → n.º de casillero → huella del paquete vigente (incluye `foto_sha256` y `precinto_sha256`) | Índice (tabla hash `Mesas`) |
| `fotos` | huella → dónde está guardada (+ `cid_ipfs` para la mejora futura) | Índice (tabla hash `Fotos`) |
| `tablero` | **solo los nodos no vacíos** del árbol, con sus sumas | Se puede recalcular desde el cuaderno |
| `raices` | número, raíz del tablero, huella del cuaderno, huella de la raíz anterior, fecha, firma del servidor, commit donde se publicó | **Solo se agrega**; la cadena no puede tener saltos |
| `anclajes` | raíz publicada → archivo `.ots` + bloque de Bitcoin | Solo se agrega |
| `llaves_servidor` | llave pública vigente del servidor + rotaciones | Solo se agrega; la primera está en `raices/0000-genesis.json` |
| `lecturas_ia` | mesa, modelo, momento (antes o después del sello), resultado, decisión de la persona | Solo se agrega; sirve también para el límite por mesa |

La seguridad **no depende de la base de datos**: aunque alguien la modifique, lo delatan la firma de Rosa, su recibo, la huella, la raíz publicada y el anclaje en Bitcoin.

## 7. Auditores

### 7.1 Qué revisa cada auditor
1. El cuaderno solo crece y ningún renglón cambió.
2. Cada firma es válida y su llave está en el padrón (considerando los reemplazos de llave).
3. Cada foto coincide con la huella sellada.
4. Las sumas del tablero cuadran en cada cruce.
5. La cadena de raíces no tiene saltos, la raíz publicada coincide con la anclada y **coincide con la que vieron los otros auditores**.
6. Cada recibo entregado corresponde a un renglón del cuaderno.
7. **La historia del repositorio continúa a la que ya tenía** (nadie la reescribió).

Además, **guarda una copia del árbol completo** cada vez que se ancla una raíz (el detective la necesita) y **publica la última raíz que vio**, para que los demás comparen.

### 7.2 Cómo lee los datos sin pasarse de los límites
- Si cada auditor leyera las 90 000 filas cada 5 minutos, serían ≈ 26 millones de lecturas al día (el límite es 5 millones). Además, los ciudadanos que verifican gastarían las 100 000 peticiones diarias del Worker.
- **Solución:**
  - Cada vez que se publica una raíz, el backend escribe un **volcado** (el cuaderno nuevo desde la raíz anterior + el árbol) en R2. La descarga desde R2 no tiene costo.
  - Los auditores leen **solo lo nuevo** desde el último renglón que ya revisaron, y recalculan el árbol en su máquina.
  - El verificador de Juan también lee desde R2 y GitHub Pages, no desde el Worker.

### 7.3 Cómo verifica el anclaje en Bitcoin
- El cliente `ots` en Python puede **crear** sellos sin un nodo Bitcoin propio, pero para **verificarlos** necesita un nodo Bitcoin Core local (sirve uno "podado").
- **Decisión:** anclar con el cliente Python (en GitHub Actions) y **verificar con la librería de JavaScript** (javascript-opentimestamps) más los encabezados de bloque de mempool.space, en el auditor y en el verificador. Esa librería es antigua: **se prueba el primer día**, y si falla, el auditor de la universidad corre un nodo podado.

## 8. Fotos: cómo llegan a cada copia
1. El celular de Rosa guarda la foto original, nombrada por su huella.
2. Junto con el acta, la foto sube al Worker, que comprueba su huella y la guarda en **R2** (bucket público de solo lectura).
3. Una tarea programada (`copiar-fotos.yml`) descarga de R2 las fotos nuevas, comprueba su huella y las sube a la carpeta `fotos/` del repositorio. Así el Worker **no** necesita un permiso para escribir en GitHub.
4. Los partidos clonan el repositorio o descargan de R2: como el nombre **es** la huella, cualquier copia se verifica sola.
- **Límite:** la copia en GitHub sirve para el piloto, no para 90 000 fotos. A gran escala, IPFS (ver mejoras futuras en la historia).

## 9. Plan B para la exposición (sin internet)
- El mismo código corre en la laptop con la implementación **local** de la capa de almacén: SQLite en Node y una carpeta para las fotos. La ventanilla única es una fila de espera dentro del mismo proceso.
- Las raíces se publican en un repositorio local y se anclan cuando vuelve la conexión.
- El lector de IA queda en "lectura pendiente" (o el simulado, solo para la demo).

## 10. Cambios que esta revisión impone a `PLAN_FINAL_HISTORIA.md`
*Aplicados en la revisión 1 de ese documento.*

| Paso | Decía | Dice ahora |
|---|---|---|
| 0 y 5 | Llave no exportable en Web Crypto, pero se firma con @noble/curves (`sign`) | Rosa **firma con Web Crypto** (`subtle.sign`); todos **verifican** con @noble/curves. Se agrega el reemplazo de llave (5.2) |
| 8 | `vacío = SHA-256(0x02 ‖ n.º_casillero)` | Vacíos iguales por nivel (sección 4); la posición la protegen la hoja llena y el camino de la prueba |
| 9 | `verify` con el cliente `ots` | Verificar con javascript-opentimestamps + mempool.space (7.3); revisión 7 del auditor y protección contra *force-push* (5.5) |
| 12 | Subresource Integrity prueba que Juan corre el código publicado | Lo prueba el **verificador descargable** con huella anclada; Subresource Integrity solo protege scripts externos (5.6) |
| Pila / plan | Escala sin aclarar | El despliegue gratuito es un **piloto** (3.1) |

## 11. División del trabajo
- **Claude Code (en la PC del autor):** `nucleo/`, `api/`, `almacen/`, `auditor/`, `merkle-py/` y `analisis/`, más lo necesario para que funcionen (`base/`, `raices/`, `.github/workflows/`, `package.json`, `wrangler.toml`), sus pruebas, el despliegue en Cloudflare y el contrato `docs/API.md`. **No toca `web/`** ni edita los planes ni `CLAUDE.md`.
- **Claude en el chat del proyecto (claude.ai):** todo el frontend en `web/` (app de mesa, verificador, vista del partido, panel del auditor y detective), a partir de `docs/API.md` y de las referencias de diseño del autor; prueba la web en el navegador (tamaño celular y PC); mantiene los planes y `CLAUDE.md`.
- **El autor:** crea las cuentas, inicia sesión, pega claves y tokens, compra los créditos de la API, hace los commits y los sube a su nombre, toma las fotos reales de actas y prueba en su celular.

## 12. Pendiente para empezar
1. Confirmar la arquitectura de esta revisión (en especial: **piloto** en plan gratuito y **ventanilla única** con Durable Object).
2. Crear la cuenta gratuita de Cloudflare.
3. Confirmar la numeración de mesas de la ONPE (¿alcanzan 2¹⁷ casilleros?).
4. Primera tarea de código (no necesita internet): **núcleo + tablero con sumas (vacíos por nivel, casillero en la hoja) + cadena de raíces + capa de almacén local, con sus pruebas**.
5. Primer día con internet: probar el *trigger* en D1 y la verificación con javascript-opentimestamps.
