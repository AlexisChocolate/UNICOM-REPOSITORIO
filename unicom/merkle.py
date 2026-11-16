import hashlib

# Prefijos de dominio de RFC 6962: impiden que un nodo interno se haga pasar por una hoja
# (ataque de segunda preimagen).
PREFIJO_HOJA = b"\x00"
PREFIJO_NODO = b"\x01"


def hash_hoja(datos: bytes) -> bytes:
    return hashlib.sha256(PREFIJO_HOJA + datos).digest()


def hash_nodo(izquierdo: bytes, derecho: bytes) -> bytes:
    return hashlib.sha256(PREFIJO_NODO + izquierdo + derecho).digest()


def _punto_corte(cantidad: int) -> int:
    potencia = 1
    while potencia * 2 < cantidad:
        potencia *= 2
    return potencia


def raiz(hojas: list) -> bytes:
    if not hojas:
        return hashlib.sha256(b"").digest()
    if len(hojas) == 1:
        return hash_hoja(hojas[0])
    corte = _punto_corte(len(hojas))
    return hash_nodo(raiz(hojas[:corte]), raiz(hojas[corte:]))


def prueba_inclusion(hojas: list, indice: int) -> list:
    if len(hojas) <= 1:
        return []
    corte = _punto_corte(len(hojas))
    if indice < corte:
        return prueba_inclusion(hojas[:corte], indice) + [raiz(hojas[corte:])]
    return prueba_inclusion(hojas[corte:], indice - corte) + [raiz(hojas[:corte])]


def verificar_inclusion(datos_hoja: bytes, indice: int, total_hojas: int, prueba: list, raiz_esperada: bytes) -> bool:
    return _recalcular_raiz(hash_hoja(datos_hoja), indice, total_hojas, list(prueba)) == raiz_esperada


def _recalcular_raiz(hash_actual: bytes, indice: int, total_hojas: int, prueba: list) -> bytes:
    if total_hojas <= 1:
        return hash_actual
    corte = _punto_corte(total_hojas)
    hermano = prueba.pop()
    if indice < corte:
        return hash_nodo(_recalcular_raiz(hash_actual, indice, corte, prueba), hermano)
    return hash_nodo(hermano, _recalcular_raiz(hash_actual, indice - corte, total_hojas - corte, prueba))


def merkle_diff(hojas_publicadas: list, hojas_auditadas: list) -> tuple:
    """Devuelve (índices alterados, comparaciones realizadas). Solo desciende por las ramas
    cuyas raíces difieren, por eso localiza una alteración en O(log n) comparaciones."""
    if len(hojas_publicadas) != len(hojas_auditadas):
        raise ValueError("Ambos conjuntos deben tener la misma cantidad de actas")
    alterados = []
    comparaciones = _diff(hojas_publicadas, hojas_auditadas, 0, alterados)
    return alterados, comparaciones


def _diff(publicadas: list, auditadas: list, desplazamiento: int, alterados: list) -> int:
    if raiz(publicadas) == raiz(auditadas):
        return 1
    if len(publicadas) == 1:
        alterados.append(desplazamiento)
        return 1
    corte = _punto_corte(len(publicadas))
    izquierda = _diff(publicadas[:corte], auditadas[:corte], desplazamiento, alterados)
    derecha = _diff(publicadas[corte:], auditadas[corte:], desplazamiento + corte, alterados)
    return 1 + izquierda + derecha
