import json
import time
from abc import ABC, abstractmethod
from pathlib import Path


class Anclador(ABC):
    """Testigo externo de una raíz de Merkle. Cada anclador aporta integridad o disponibilidad,
    nunca ambas: la integridad viene de redes públicas, la disponibilidad del respaldo propio."""

    nombre: str

    @abstractmethod
    def anclar(self, raiz_hex: str) -> dict:
        ...

    @abstractmethod
    def verificar(self, raiz_hex: str, comprobante: dict) -> bool:
        ...


class AncladorOpenTimestamps(Anclador):
    nombre = "bitcoin-opentimestamps"

    def anclar(self, raiz_hex: str) -> dict:
        raise NotImplementedError("Pendiente: enviar la raíz a los calendarios de OpenTimestamps")

    def verificar(self, raiz_hex: str, comprobante: dict) -> bool:
        raise NotImplementedError("Pendiente: verificar el comprobante .ots contra la cadena de Bitcoin")


class RespaldoLocal(Anclador):
    nombre = "respaldo-local"

    def __init__(self, ruta_registro: Path):
        self.ruta_registro = ruta_registro

    def anclar(self, raiz_hex: str) -> dict:
        comprobante = {"raiz": raiz_hex, "sellado_en": int(time.time())}
        with self.ruta_registro.open("a", encoding="utf-8") as registro:
            registro.write(json.dumps(comprobante) + "\n")
        return comprobante

    def verificar(self, raiz_hex: str, comprobante: dict) -> bool:
        if not self.ruta_registro.exists():
            return False
        lineas = self.ruta_registro.read_text(encoding="utf-8").splitlines()
        return any(json.loads(linea) == comprobante for linea in lineas) and comprobante["raiz"] == raiz_hex


def anclaje_multiple(raiz_hex: str, ancladores: list) -> dict:
    comprobantes = {}
    for anclador in ancladores:
        try:
            comprobantes[anclador.nombre] = anclador.anclar(raiz_hex)
        except NotImplementedError as pendiente:
            comprobantes[anclador.nombre] = {"estado": "pendiente", "detalle": str(pendiente)}
    return comprobantes
