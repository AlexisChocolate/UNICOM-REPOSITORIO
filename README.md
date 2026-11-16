# UNICOM — Integridad y auditoría verificable de actas electorales

Concurso de Proyectos Estudiantiles EPIS 2026-II · UNA Puno · Área: Ciencias de la Computación / Ciberseguridad
Autor: Anderson Alexis Condori Castillo

> No usamos blockchain para votar; la usamos como notario.

El voto sigue en papel, que es la fuente de verdad. UNICOM fija públicamente la huella de cada acta desde la mesa,
la ancla en redes públicas independientes y permite que cualquiera compruebe, sin confiar en el software,
que el resultado publicado corresponde a las actas firmadas.

## Flujo

```
Acta firmada en mesa → SHA-256 → Árbol de Merkle (RFC 6962) → Anclaje múltiple (Bitcoin / OpenTimestamps + respaldo)
        → Sorteo de auditoría con hash de bloque t+k → Auditoría de riesgo limitado contra el papel
        → Merkle-diff localiza actas alteradas
```

## Estado

| Módulo | Archivo | Estado |
|---|---|---|
| Acta y huella canónica | `unicom/acta.py` | Listo |
| Árbol de Merkle, pruebas de inclusión, Merkle-diff | `unicom/merkle.py` | Listo |
| Sorteo público reproducible | `unicom/sorteo.py` | Listo |
| Anclaje múltiple | `unicom/anclaje.py` | Respaldo local listo; Bitcoin pendiente |
| Auditoría de riesgo limitado | `unicom/auditoria.py` | Pendiente |
| Forense estadística por acta | — | Pendiente |
| Interfaz web y verificación ciudadana | — | Pendiente |

## Ejecutar

Requiere Python 3.10+ (solo biblioteca estándar).

```
python3 demo.py
python3 -m unittest
```

## Fundamento

- Park, Specter, Narula y Rivest (2021), *Going from bad to worse: from Internet voting to blockchain voting*.
- Rivest y Wack (2006), *software independence*.
- Laurie, Langley y Kasper (2013), RFC 6962: Certificate Transparency.
- Lindeman y Stark (2012), auditorías de riesgo limitado.
- Bonneau, Clark y Goldfeder (2015), Bitcoin como fuente pública de aleatoriedad.
