# UNICOM — instrucciones para Claude Code

UNICOM: Sistema criptográfico a prueba de fraude electoral. Concurso de Proyectos Estudiantiles EPIS 2026-II, UNA Puno.
Autor: Anderson Alexis Condori Castillo · Integrante: Mayk Olvier Pilco Supo · Asesor: Ing. Ubaldo Allca Mamani.
Exposición: viernes 27 de noviembre de 2026.

## Objetivo: todo funcionando en la web
El producto final vive en internet: web en GitHub Pages, backend en Cloudflare (Workers + Durable Object + D1 + R2), raíces en el repositorio público, auditor en GitHub Actions, anclaje en Bitcoin. Lo local sirve solo para probar antes de publicar y como plan B sin internet en la exposición.
- Desplegar desde el primer día una versión mínima que funcione de punta a punta en la web (mesa → backend → cuaderno → raíz publicada), y crecer sobre ella. No dejar el despliegue para el final.
- Cada módulo se da por terminado cuando funciona desplegado, no solo en local.

## Reparto del trabajo (manda sobre cualquier otra indicación, incluidos los planes de docs/)
- **PROHIBIDO tocar `web/`:** no crear, modificar, mover ni borrar nada dentro de `web/`, ni generar páginas HTML, CSS o pantallas en ninguna otra carpeta. El frontend se diseña en el chat de claude.ai. Si una tarea parece necesitar algo de `web/`, detenerse y avisar al autor.
- **Carpetas de Claude Code:** `nucleo/`, `api/`, `almacen/`, `auditor/`, `merkle-py/` y `analisis/`. También, solo lo necesario para que esas funcionen: `base/` (esquema SQL), `raices/` (génesis y raíces publicadas), `.github/workflows/` (pruebas, publicación, auditor), la raíz del repositorio (`package.json`, `wrangler.toml`) y `docs/API.md`.
- **No editar** `docs/PLAN_FINAL_ARQUITECTURA.md`, `docs/PLAN_FINAL_HISTORIA.md` ni este `CLAUDE.md`: los mantiene el autor desde el chat. Si algo de ellos está mal, avisar.
- **No tocar sin avisar** `unicom/`, `tests/` ni `demo.py` (versión anterior en Python).
- **Contrato con el frontend:** mantener `docs/API.md` al día con cada endpoint (ruta, método, JSON de entrada y salida con ejemplos reales, errores) y con las funciones del núcleo que usa la web (nombre, parámetros, qué devuelven). El núcleo debe poder cargarse en el navegador como módulo ES, sin pasos de compilación.
- Donde los planes digan que Claude hace la web o la prueba en el navegador, eso corresponde al chat, no a Claude Code.

## Leer antes de programar
- `docs/PLAN_FINAL_ARQUITECTURA.md`: capas, despliegue, límites gratuitos, seguridad de cada pieza, base de datos.
- `docs/PLAN_FINAL_HISTORIA.md`: los 12 pasos (mesa 045123), algoritmo y tecnología de cada uno, plan por días.
Si el código y los planes no coinciden, manda el plan, salvo en el reparto del trabajo, donde manda la sección anterior. Si el plan tiene un error, avísalo antes de apartarte de él.

## Reglas del sistema que el código nunca rompe
1. El papel manda: UNICOM no toca el voto; solo vigila el acta.
2. La IA solo advierte: nunca escribe en el acta ni bloquea el sello. Un solo lector (Claude). Si falla: "lectura pendiente", sin otra IA.
3. Sin personeros no se frena nada: firma el miembro de mesa; personeros opcionales.
4. El servidor puede ser atacado: todo se verifica con firmas, huellas, raíces publicadas y anclaje, sin confiar en el servidor.
5. Los dos carriles no se mezclan: la lista de prioridad nunca condiciona el sorteo.
6. Cualquiera puede comprobarlo: verificador y auditor usan solo datos públicos.

## Decisiones técnicas fijas
- JavaScript para núcleo, tablero, detective, verificador, auditor y backend (un solo núcleo compartido). Python solo para estadística, mediciones y la segunda implementación del árbol.
- Firmar con Web Crypto (llave no exportable). Verificar siempre con @noble/curves, en todos lados.
- JSON canónico: claves ordenadas, solo enteros y texto ASCII (partidos como códigos `"P07"`).
- Árbol con sumas de 2¹⁷ casilleros fijos; hoja con el n.º de casillero; vacíos iguales por nivel; solo se guardan nodos no vacíos.
- Backend: Cloudflare Workers + Durable Object como ventanilla única + D1 + R2, plan gratuito, escala de piloto.
- Capa de almacén con dos implementaciones (Cloudflare y local) para que el plan B sin internet use el mismo código.
- Criptografía: nada casero. Probar Ed25519 con los vectores de RFC 8032, sec. 7.1.

## Código existente
`unicom/`, `tests/` y `demo.py` son la primera versión en Python (Merkle RFC 6962 sin sumas, sorteo, anclaje). El `README.md` describe esa versión y está desactualizado. El Merkle de Python se adapta a sumas y casilleros fijos para ser la segunda implementación (`merkle-py/` en el plan); no borrar nada de esto sin avisar.

## Estilo de código (obligatorio)
- Sin separadores decorativos ni encabezados decorativos, en el código y en la consola.
- Sin comentarios obvios: solo los que justifican una decisión técnica (por ejemplo, citando la sección del RFC o del paper).
- Las funciones devuelven valores; no imprimen. Solo el punto de entrada (main, CLI, demo) imprime.
- Nombres claros y consistentes en español, sin variables de una letra.
- Una instrucción por línea.
- Datos de prueba con contexto real: mesas como 045123, Juliaca, Partido Sol, Partido Río; nunca "A", "B" o "foo".
- Pruebas automáticas para cada módulo; `npm test` y `python -m unittest` deben pasar antes de dar algo por terminado.

## Cómo trabajar con el autor
- No es experto en criptografía ni en despliegue: al explicarle, usar palabras simples, ejemplos cotidianos y aclarar cada término.
- No inventar nada: cada enlace, cifra o fuente debe estar comprobado antes de escribirlo.
- Commits: solo a nombre del autor. No agregar `Co-Authored-By` ni otras líneas de atribución a Claude.
- No subir (push), desplegar ni publicar sin que el autor lo confirme.
- Nunca leer, imprimir ni guardar en el repositorio claves, tokens o el archivo `.dev.vars`. El autor pega las claves él mismo.
- Antes de algo que no se pueda deshacer (borrar archivos, reescribir el historial, gastar créditos), preguntar.
