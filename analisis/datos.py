"""Lectura de los datos públicos de UNICOM para el análisis (sin confiar en el servidor para nada más)."""

import csv
import json
import urllib.request

from carril_a import Mesa

DIRECCION_API = "https://unicom-api.myk-unicom.workers.dev"
UMBRAL_MILESIMAS = 800


def _pedir(direccion):
    with urllib.request.urlopen(direccion, timeout=60) as respuesta:
        return json.loads(respuesta.read().decode("utf-8"))


def renglones_del_cuaderno(direccion=DIRECCION_API):
    renglones = []
    while True:
        pagina = _pedir(f"{direccion}/cuaderno?desde={len(renglones) + 1}&limite=500")["renglones"]
        renglones.extend(pagina)
        if len(pagina) < 500:
            return renglones


def electores_desde_csv(ruta):
    """CSV con columnas mesa,electores_habiles (de los datos por mesa que publica la ONPE)."""
    with open(ruta, encoding="utf-8") as archivo:
        return {fila["mesa"]: int(fila["electores_habiles"]) for fila in csv.DictReader(archivo)}


def mesas_desde_cuaderno(renglones, electores_por_mesa):
    """La última acta de cada mesa, con su marca del lector de IA y las alertas que le correspondan."""
    actas = {}
    lecturas = {}
    objeciones = {}
    for renglon in renglones:
        contenido = renglon["contenido"]
        if renglon["tipo"] == "acta":
            actas[contenido["paquete"]["mesa"]] = contenido["paquete"]
        elif renglon["tipo"] == "lectura_ia" and contenido["estado"] == "leida":
            lecturas[contenido["mesa"]] = contenido["resultado"]
        elif renglon["tipo"] == "opinion" and renglon["contenido"]["contenido"]["tipo"] == "objecion":
            mesa = renglon["contenido"]["contenido"]["mesa"]
            objeciones[mesa] = objeciones.get(mesa, 0) + 1
    mesas = []
    for numero, paquete in actas.items():
        if numero not in electores_por_mesa:
            continue
        marca = "verde"
        lectura = lecturas.get(numero)
        if lectura:
            for categoria, campo in lectura.items():
                if campo["valor"] is not None and campo["valor"] != paquete["votos"].get(categoria):
                    marca = "rojo"
                elif marca == "verde" and (campo["valor"] is None or campo["tachon"] or campo["confianza_milesimas"] < UMBRAL_MILESIMAS):
                    marca = "amarillo"
        alertas = [f"objetada por {objeciones[numero]} personero(s)"] if numero in objeciones else []
        mesas.append(
            Mesa(
                mesa=numero,
                electores_habiles=electores_por_mesa[numero],
                votos=paquete["votos"],
                personeros_presentes=paquete["personeros_presentes"],
                marca_ia=marca,
                alertas=alertas,
            )
        )
    return mesas
