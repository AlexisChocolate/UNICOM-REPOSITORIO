from dataclasses import dataclass


@dataclass
class ResultadoAuditoria:
    mesas_revisadas: int
    discrepancias: list
    riesgo_limite: float
    resultado_confirmado: bool


def auditoria_riesgo_limitado(actas_publicadas: list, conteo_papel: dict, riesgo_limite: float) -> ResultadoAuditoria:
    raise NotImplementedError("Pendiente: auditoría de riesgo limitado (Lindeman y Stark, 2012) contra el conteo en papel")
