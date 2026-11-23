"""Carril B (Paso 11): auditoría de riesgo limitado con ONEAudit, usando solo el subtotal firmado de cada mesa.

Idea de ONEAudit (Stark, 2023): a cada cédula de una mesa se le asigna como "registro" el promedio del
asorter de su mesa, calculado con el subtotal firmado. Así se puede hacer una auditoría por comparación
(con asorters de sobreconteo) sacando cédulas sueltas del sobre lacrado, sin contar mesas enteras.

Para la mayoría simple, por cada par (ganador, perdedor):
  A(cédula) = (1 + [voto al ganador] - [voto al perdedor]) / 2, en [0, 1]
  A_mesa    = promedio de A en la mesa según su subtotal firmado
  v         = 2 * promedio_reportado(A) - 1  (margen del asorter; debe ser > 0)
  B(cédula) = (1 - (A_mesa - A(cédula))) / (2 - v), en [0, 2 / (2 - v)]
El ganador reportado es el verdadero si y solo si el promedio verdadero de B es mayor que 1/2.

La prueba es la supermartingala ALPHA con eta fijo (Stark, 2023, "ALPHA"):
  T_k = producto de [ (B_i / mu) (eta - mu) / (u - mu) + (u - eta) / (u - mu) ], con mu = 1/2,
  eta = 1 / (2 - v) (lo que valdría B sin errores) y u = 2 / (2 - v).
El muestreo es con reemplazo y la auditoría confirma cuando T_k >= 1 / alfa para todos los pares.
"""

import hashlib
import math
from dataclasses import dataclass

import numpy

MU = 0.5


@dataclass(frozen=True)
class Lote:
    mesa: str
    votos: dict

    @property
    def cedulas(self):
        return sum(self.votos.values())


def _media_asorter(votos, ganador, perdedor):
    total = sum(votos.values())
    return (total + votos.get(ganador, 0) - votos.get(perdedor, 0)) / (2 * total)


def ganador_reportado(lotes):
    totales = {}
    for lote in lotes:
        for categoria, cantidad in lote.votos.items():
            totales[categoria] = totales.get(categoria, 0) + cantidad
    return max(totales, key=totales.get), totales


def pares_a_auditar(lotes, candidatos):
    ganador, _ = ganador_reportado(lotes)
    return [(ganador, perdedor) for perdedor in candidatos if perdedor != ganador]


def margen_reportado(lotes, ganador, perdedor):
    total = sum(lote.cedulas for lote in lotes)
    media = sum(lote.cedulas * _media_asorter(lote.votos, ganador, perdedor) for lote in lotes) / total
    return 2 * media - 1


def valor_b(voto_cedula, lote, ganador, perdedor, margen):
    asorter_cedula = (1 + (voto_cedula == ganador) - (voto_cedula == perdedor)) / 2
    return (1 - (_media_asorter(lote.votos, ganador, perdedor) - asorter_cedula)) / (2 - margen)


def factor_alpha(valor, margen):
    eta = 1 / (2 - margen)
    tope = 2 / (2 - margen)
    return (valor / MU) * (eta - MU) / (tope - MU) + (tope - eta) / (tope - MU)


class Auditoria:
    """Acumula las cédulas revisadas y dice cuándo el riesgo medido baja del límite."""

    def __init__(self, lotes, candidatos, alfa=0.05):
        self.lotes = {lote.mesa: lote for lote in lotes}
        self.alfa = alfa
        self.pares = pares_a_auditar(lotes, candidatos)
        self.margenes = {par: margen_reportado(lotes, *par) for par in self.pares}
        sin_margen = [par for par, margen in self.margenes.items() if margen <= 0]
        if sin_margen:
            raise ValueError(f"Con estos subtotales no hay ganador claro frente a {sin_margen}")
        self.estadisticos = {par: 1.0 for par in self.pares}
        self.revisadas = 0

    def registrar(self, mesa, voto_cedula):
        lote = self.lotes[mesa]
        for par in self.pares:
            self.estadisticos[par] *= factor_alpha(valor_b(voto_cedula, lote, *par, self.margenes[par]), self.margenes[par])
        self.revisadas += 1

    @property
    def riesgo_medido(self):
        return min(1.0, max(1 / estadistico if estadistico > 0 else math.inf for estadistico in self.estadisticos.values()))

    @property
    def confirmada(self):
        return self.riesgo_medido <= self.alfa


def elegir_cedulas(semilla, lotes, cantidad):
    """Muestreo con reemplazo de cédulas: método de Rivest (SHA-256 de "semilla,contador", contador desde 1)
    sobre la numeración 1..N de todas las cédulas, en el orden de las mesas."""
    ordenados = sorted(lotes, key=lambda lote: lote.mesa)
    limites = numpy.cumsum([lote.cedulas for lote in ordenados])
    total = int(limites[-1])
    elegidas = []
    for contador in range(1, cantidad + 1):
        valor = int(hashlib.sha256(f"{semilla},{contador}".encode("utf-8")).hexdigest(), 16)
        numero = 1 + valor % total
        posicion = int(numpy.searchsorted(limites, numero))
        anteriores = int(limites[posicion - 1]) if posicion > 0 else 0
        elegidas.append((ordenados[posicion].mesa, numero - anteriores))
    return elegidas


def muestra_rivest(semilla, total, cantidad):
    return [1 + int(hashlib.sha256(f"{semilla},{contador}".encode("utf-8")).hexdigest(), 16) % total for contador in range(1, cantidad + 1)]


def simular_auditoria(lotes_reportados, lotes_verdaderos, candidatos, alfa, maximo, generador):
    """Una auditoría simulada: se sacan cédulas al azar de los sobres verdaderos y se comparan con lo reportado."""
    auditoria = Auditoria(lotes_reportados, candidatos, alfa)
    verdaderos = {lote.mesa: lote for lote in lotes_verdaderos}
    mesas = [lote.mesa for lote in lotes_verdaderos]
    pesos = numpy.array([lote.cedulas for lote in lotes_verdaderos], dtype=float)
    pesos /= pesos.sum()
    while auditoria.revisadas < maximo:
        mesa = mesas[generador.choice(len(mesas), p=pesos)]
        votos = verdaderos[mesa].votos
        categorias = list(votos)
        cantidades = numpy.array([votos[categoria] for categoria in categorias], dtype=float)
        voto = categorias[generador.choice(len(categorias), p=cantidades / cantidades.sum())]
        auditoria.registrar(mesa, voto)
        if auditoria.confirmada:
            return auditoria.revisadas
    return None


def tamano_de_muestra_esperado(lotes, candidatos, alfa=0.05, simulaciones=200, maximo=20000, semilla=20261127):
    """Cuántas cédulas haría falta revisar si los subtotales firmados son correctos (mediana y percentil 90)."""
    generador = numpy.random.default_rng(semilla)
    tamanos = [simular_auditoria(lotes, lotes, candidatos, alfa, maximo, generador) for _ in range(simulaciones)]
    completas = [tamano if tamano is not None else maximo for tamano in tamanos]
    return {"mediana": float(numpy.median(completas)), "percentil_90": float(numpy.percentile(completas, 90)), "sin_confirmar": tamanos.count(None)}
