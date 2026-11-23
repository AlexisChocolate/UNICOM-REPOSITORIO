"""Medición del lector de IA (Paso 4): porcentaje de error y umbral de confianza para el amarillo.

Entrada: una fila por casilla leída con (valor_real, valor_leido, confianza), sacada de 20-50 fotos reales.
La confianza que Claude declara no está calibrada, por eso el umbral 0,8 del plan es provisional: aquí se elige
el umbral que mejor separa aciertos de errores (índice de Youden: errores atrapados menos aciertos molestados).
"""

import math


def intervalo_wilson(exitos, total, cuantil=1.96):
    if total == 0:
        return (0.0, 1.0)
    proporcion = exitos / total
    centro = (proporcion + cuantil * cuantil / (2 * total)) / (1 + cuantil * cuantil / total)
    margen = cuantil * math.sqrt(proporcion * (1 - proporcion) / total + cuantil * cuantil / (4 * total * total)) / (1 + cuantil * cuantil / total)
    return (max(0.0, centro - margen), min(1.0, centro + margen))


def tasa_de_error(filas):
    errores = sum(1 for real, leido, _ in filas if leido != real)
    total = len(filas)
    return {"errores": errores, "total": total, "tasa": errores / total if total else 0.0, "intervalo_95": intervalo_wilson(errores, total)}


def elegir_umbral(filas):
    """Prueba cada confianza observada como umbral: debajo de él, la casilla sale amarilla."""
    errores = [confianza for real, leido, confianza in filas if leido != real]
    aciertos = [confianza for real, leido, confianza in filas if leido == real]
    if not errores or not aciertos:
        return {"umbral": None, "motivo": "hacen falta aciertos y errores para elegir un umbral"}
    mejor = None
    for umbral in sorted({confianza for _, _, confianza in filas} | {1.01}):
        atrapados = sum(1 for confianza in errores if confianza < umbral) / len(errores)
        molestados = sum(1 for confianza in aciertos if confianza < umbral) / len(aciertos)
        indice = atrapados - molestados
        if mejor is None or indice > mejor["indice_youden"]:
            mejor = {"umbral": umbral, "indice_youden": indice, "errores_atrapados": atrapados, "aciertos_marcados": molestados}
    return mejor
