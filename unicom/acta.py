import hashlib
import json
from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class Acta:
    codigo_mesa: str
    local_votacion: str
    votos_por_lista: dict
    votos_blancos: int
    votos_nulos: int
    electores_habiles: int

    def total_emitidos(self) -> int:
        return sum(self.votos_por_lista.values()) + self.votos_blancos + self.votos_nulos

    def es_consistente(self) -> bool:
        return self.total_emitidos() <= self.electores_habiles

    def serializar(self) -> bytes:
        # Serialización canónica: el mismo contenido debe producir siempre los mismos bytes,
        # si no, dos copias idénticas del acta tendrían huellas distintas.
        return json.dumps(asdict(self), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    def huella(self) -> str:
        return hashlib.sha256(self.serializar()).hexdigest()
