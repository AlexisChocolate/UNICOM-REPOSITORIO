import hashlib


def semilla_desde_bloque(hash_bloque_hex: str, raiz_anclada_hex: str) -> bytes:
    # La semilla combina un bloque minado DESPUÉS del anclaje (t+k) con la raíz ya comprometida:
    # quien altera actas decide antes de conocer qué mesas serán auditadas.
    return hashlib.sha256(bytes.fromhex(hash_bloque_hex) + bytes.fromhex(raiz_anclada_hex)).digest()


def seleccionar_mesas(semilla: bytes, total_mesas: int, cantidad: int) -> list:
    """Muestreo determinista sin reemplazo: cualquiera con la misma semilla obtiene la misma muestra."""
    if cantidad > total_mesas:
        raise ValueError("La muestra no puede superar el total de mesas")
    seleccionadas = []
    contador = 0
    while len(seleccionadas) < cantidad:
        bloque_aleatorio = hashlib.sha256(semilla + contador.to_bytes(8, "big")).digest()
        indice = int.from_bytes(bloque_aleatorio, "big") % total_mesas
        if indice not in seleccionadas:
            seleccionadas.append(indice)
        contador += 1
    return seleccionadas
