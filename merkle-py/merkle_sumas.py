"""Segunda implementación del tablero con sumas (Paso 8), independiente de la de JavaScript.

Si las dos dan la misma raíz para los mismos datos, hay más evidencia de que el código está bien.
Reglas (PLAN_FINAL_ARQUITECTURA.md, sec. 4):
  hoja llena  = SHA-256(0x00 || casillero (4 bytes) || huella del acta (32 bytes) || sumas)
  nodo        = SHA-256(0x01 || huella izq || huella der || sumas izq || sumas der)
  vacío nivel 0 = SHA-256(0x02); vacío nivel k = nodo de dos vacíos del nivel k-1 con sumas 0
Cada suma va en 8 bytes big-endian, en el orden fijo de las categorías.
"""

import hashlib
from dataclasses import dataclass

NIVELES = 17
CASILLEROS = 2 ** NIVELES

PREFIJO_HOJA = b"\x00"
PREFIJO_NODO = b"\x01"
PREFIJO_VACIO = b"\x02"


@dataclass(frozen=True)
class Nodo:
    huella: bytes
    sumas: tuple


def _codificar_sumas(sumas):
    return b"".join(suma.to_bytes(8, "big") for suma in sumas)


def _validar_sumas(sumas, cantidad):
    if len(sumas) != cantidad:
        raise ValueError(f"Se esperaban {cantidad} sumas")
    for suma in sumas:
        if not isinstance(suma, int) or isinstance(suma, bool) or suma < 0 or suma > 2 ** 53 - 1:
            raise ValueError("Las sumas deben ser enteros entre 0 y 2^53 - 1")


def hoja_llena(casillero, huella_acta_hex, sumas):
    if not 0 <= casillero < CASILLEROS:
        raise ValueError(f"Casillero fuera del tablero: {casillero}")
    _validar_sumas(sumas, len(sumas))
    datos = PREFIJO_HOJA + casillero.to_bytes(4, "big") + bytes.fromhex(huella_acta_hex) + _codificar_sumas(sumas)
    return Nodo(hashlib.sha256(datos).digest(), tuple(sumas))


def nodo_padre(izquierdo, derecho):
    _validar_sumas(derecho.sumas, len(izquierdo.sumas))
    datos = PREFIJO_NODO + izquierdo.huella + derecho.huella + _codificar_sumas(izquierdo.sumas) + _codificar_sumas(derecho.sumas)
    sumas = tuple(a_izquierda + a_derecha for a_izquierda, a_derecha in zip(izquierdo.sumas, derecho.sumas))
    return Nodo(hashlib.sha256(datos).digest(), sumas)


def vacios_por_nivel(cantidad_categorias):
    vacios = [Nodo(hashlib.sha256(PREFIJO_VACIO).digest(), (0,) * cantidad_categorias)]
    for _ in range(NIVELES):
        vacios.append(nodo_padre(vacios[-1], vacios[-1]))
    return vacios


def construir_tablero(hojas, cantidad_categorias):
    """hojas: lista de (casillero, huella_acta_hex, sumas). Devuelve la lista de niveles (dict índice -> Nodo)."""
    vacios = vacios_por_nivel(cantidad_categorias)
    nivel_actual = {}
    for casillero, huella_acta_hex, sumas in hojas:
        _validar_sumas(sumas, cantidad_categorias)
        if casillero in nivel_actual:
            raise ValueError(f"Casillero repetido: {casillero}")
        nivel_actual[casillero] = hoja_llena(casillero, huella_acta_hex, sumas)
    niveles = [nivel_actual]
    for nivel in range(NIVELES):
        superior = {}
        for padre in sorted({indice >> 1 for indice in niveles[nivel]}):
            izquierdo = niveles[nivel].get(2 * padre, vacios[nivel])
            derecho = niveles[nivel].get(2 * padre + 1, vacios[nivel])
            superior[padre] = nodo_padre(izquierdo, derecho)
        niveles.append(superior)
    return niveles


def raiz(hojas, cantidad_categorias):
    niveles = construir_tablero(hojas, cantidad_categorias)
    return niveles[NIVELES].get(0, vacios_por_nivel(cantidad_categorias)[NIVELES])


def prueba_inclusion(niveles, casillero, cantidad_categorias):
    vacios = vacios_por_nivel(cantidad_categorias)
    return [niveles[nivel].get((casillero >> nivel) ^ 1, vacios[nivel]) for nivel in range(NIVELES)]


def verificar_inclusion(casillero, huella_acta_hex, sumas, hermanos, raiz_esperada):
    if len(hermanos) != NIVELES:
        return False
    actual = hoja_llena(casillero, huella_acta_hex, sumas)
    for nivel, hermano in enumerate(hermanos):
        if (casillero >> nivel) & 1:
            actual = nodo_padre(hermano, actual)
        else:
            actual = nodo_padre(actual, hermano)
    return actual == raiz_esperada
