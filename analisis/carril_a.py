"""Carril A (Paso 11): lista de prioridad. Señala dónde mirar primero; nunca acusa ni toca el sorteo.

Fuentes del plan:
- Último dígito con chi-cuadrado, solo en conteos de 2 dígitos o más (Beber y Scacco, 2012, sec. 2),
  y pares de dígitos (repetidos y adyacentes) del mismo trabajo.
- Porcentajes enteros: se excluyen mesas de menos de 100 electores y se compara con Monte Carlo (Kobak et al., 2016, sec. 2).
- Huella participación-voto: histograma 2D (Klimek et al., 2012, fig. 1).
- No se usa la ley de Benford (Deckert et al., 2011).
- La validez de un acta no se decide con estadística (Res. 1052-2026-JNE, punto 2.8): esto solo ordena.
"""

from dataclasses import dataclass, field

import numpy
from scipy import stats

PROBABILIDAD_PAR_REPETIDO = 0.1
PROBABILIDAD_PAR_ADYACENTE = 0.18
ELECTORES_MINIMOS_PORCENTAJE = 100


@dataclass
class Mesa:
    mesa: str
    electores_habiles: int
    votos: dict
    personeros_presentes: bool = True
    marca_ia: str = "verde"
    alertas: list = field(default_factory=list)

    @property
    def votantes(self):
        return sum(self.votos.values())


def prueba_ultimo_digito(conteos):
    validos = [conteo for conteo in conteos if conteo >= 10]
    if len(validos) < 10:
        return {"aplicable": False, "motivo": "hacen falta al menos 10 conteos de 2 dígitos o más", "n": len(validos)}
    frecuencias = numpy.bincount([conteo % 10 for conteo in validos], minlength=10)
    estadistico, valor_p = stats.chisquare(frecuencias)
    return {"aplicable": True, "n": len(validos), "chi2": float(estadistico), "valor_p": float(valor_p), "frecuencias": frecuencias.tolist()}


def prueba_pares_de_digitos(conteos):
    validos = [conteo for conteo in conteos if conteo >= 10]
    if len(validos) < 10:
        return {"aplicable": False, "motivo": "hacen falta al menos 10 conteos de 2 dígitos o más", "n": len(validos)}
    pares = [((conteo // 10) % 10, conteo % 10) for conteo in validos]
    repetidos = sum(1 for penultimo, ultimo in pares if penultimo == ultimo)
    adyacentes = sum(1 for penultimo, ultimo in pares if abs(penultimo - ultimo) == 1)
    return {
        "aplicable": True,
        "n": len(validos),
        "repetidos": repetidos,
        "valor_p_repetidos": float(stats.binomtest(repetidos, len(validos), PROBABILIDAD_PAR_REPETIDO).pvalue),
        "adyacentes": adyacentes,
        "valor_p_adyacentes": float(stats.binomtest(adyacentes, len(validos), PROBABILIDAD_PAR_ADYACENTE).pvalue),
    }


def _es_porcentaje_entero(parte, total):
    return total > 0 and (100 * parte) % total == 0


def prueba_porcentajes_enteros(mesas, categoria_ganadora, simulaciones=2000, semilla=20261127):
    """Cuenta mesas con participación o voto ganador en porcentaje entero y lo compara con mesas simuladas
    del mismo tamaño y las mismas tasas (Monte Carlo), porque en mesas chicas aparecen por azar."""
    grandes = [mesa for mesa in mesas if mesa.electores_habiles >= ELECTORES_MINIMOS_PORCENTAJE and mesa.votantes > 0]
    if not grandes:
        return {"aplicable": False, "motivo": f"ninguna mesa tiene {ELECTORES_MINIMOS_PORCENTAJE} electores o más"}
    observados = sum(
        _es_porcentaje_entero(mesa.votantes, mesa.electores_habiles) or _es_porcentaje_entero(mesa.votos[categoria_ganadora], mesa.votantes)
        for mesa in grandes
    )
    generador = numpy.random.default_rng(semilla)
    electores = numpy.array([mesa.electores_habiles for mesa in grandes])
    tasa_participacion = numpy.array([mesa.votantes / mesa.electores_habiles for mesa in grandes])
    tasa_ganador = numpy.array([mesa.votos[categoria_ganadora] / mesa.votantes for mesa in grandes])
    simulados = numpy.empty(simulaciones, dtype=int)
    for vuelta in range(simulaciones):
        votantes = generador.binomial(electores, tasa_participacion)
        ganador = generador.binomial(votantes, tasa_ganador)
        entero_participacion = (100 * votantes) % electores == 0
        entero_ganador = (votantes > 0) & ((100 * ganador) % numpy.maximum(votantes, 1) == 0)
        simulados[vuelta] = int(numpy.sum(entero_participacion | entero_ganador))
    valor_p = float((numpy.sum(simulados >= observados) + 1) / (simulaciones + 1))
    return {"aplicable": True, "mesas": len(grandes), "observados": int(observados), "esperados": float(simulados.mean()), "valor_p": valor_p}


def huella_participacion_voto(mesas, categoria_ganadora, divisiones=20):
    participacion = [mesa.votantes / mesa.electores_habiles for mesa in mesas if mesa.electores_habiles > 0 and mesa.votantes > 0]
    voto = [mesa.votos[categoria_ganadora] / mesa.votantes for mesa in mesas if mesa.electores_habiles > 0 and mesa.votantes > 0]
    histograma, bordes_participacion, bordes_voto = numpy.histogram2d(participacion, voto, bins=divisiones, range=[[0, 1], [0, 1]])
    return {"histograma": histograma.astype(int).tolist(), "bordes_participacion": bordes_participacion.tolist(), "bordes_voto": bordes_voto.tolist()}


def lista_de_prioridad(mesas, categoria_ganadora):
    """Ordena las mesas por señales. Cada razón queda escrita para que un observador sepa por qué mirar ahí."""
    con_votos = [mesa for mesa in mesas if mesa.electores_habiles > 0 and mesa.votantes > 0]
    participacion = numpy.array([mesa.votantes / mesa.electores_habiles for mesa in con_votos])
    voto = numpy.array([mesa.votos[categoria_ganadora] / mesa.votantes for mesa in con_votos])
    z_participacion = stats.zscore(participacion) if len(con_votos) > 2 else numpy.zeros(len(con_votos))
    z_voto = stats.zscore(voto) if len(con_votos) > 2 else numpy.zeros(len(con_votos))
    lista = []
    for posicion, mesa in enumerate(con_votos):
        puntaje = 0
        razones = []
        # Esquina de Klimek et al.: participación y voto ganador a la vez muy por encima del resto.
        if z_participacion[posicion] > 2 and z_voto[posicion] > 2:
            puntaje += 3
            razones.append("participación y voto ganador muy por encima de las demás mesas")
        if mesa.votantes > mesa.electores_habiles:
            puntaje += 3
            razones.append("más votantes que electores hábiles")
        if mesa.marca_ia == "rojo":
            puntaje += 2
            razones.append("el lector de IA leyó otro número")
        elif mesa.marca_ia == "amarillo":
            puntaje += 1
            razones.append("el lector de IA marcó un campo dudoso")
        if not mesa.personeros_presentes:
            puntaje += 1
            razones.append("sin personero")
        for alerta in mesa.alertas:
            puntaje += 2
            razones.append(alerta)
        lista.append({"mesa": mesa.mesa, "puntaje": puntaje, "razones": razones})
    return sorted(lista, key=lambda fila: (-fila["puntaje"], fila["mesa"]))
