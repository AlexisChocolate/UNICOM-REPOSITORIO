"""Fotos recicladas (Paso 6): la misma acta fotografiada otra vez y presentada como de otra mesa.

1. Copia exacta: SHA-256 (lo hace el servidor con la alerta foto_repetida).
2. Copia "parecida": se endereza el acta (4 esquinas y corrección de perspectiva, como Pant et al. con sus
   formularios), se recorta la zona escrita a mano y se compara con hash perceptual. Zauner (2010) muestra que
   ninguna función resiste una rotación de 5° (sec. 6.3.4), por eso se endereza antes, y recomienda combinar
   una función rápida con otra que distinga mejor (sec. 6.4): average_hash filtra y phash confirma.
Los umbrales son provisionales hasta medirlos con fotos reales.
"""

from itertools import combinations

import cv2
import imagehash
import numpy
from PIL import Image

ANCHO_ENDEREZADO = 1000
ALTO_ENDEREZADO = 1400
# Huellas de 16 x 16 (256 bits): con 8 x 8 dos actas distintas del mismo formulario quedaban a solo 14 bits.
TAMANO_HASH = 16
UMBRAL_AVERAGE_HASH = 20
UMBRAL_PHASH = 24
ZONA_ESCRITA = (0.05, 0.15, 0.95, 0.95)


def _ordenar_esquinas(puntos):
    puntos = puntos.reshape(4, 2).astype("float32")
    sumas = puntos.sum(axis=1)
    diferencias = numpy.diff(puntos, axis=1).ravel()
    return numpy.array(
        [puntos[numpy.argmin(sumas)], puntos[numpy.argmin(diferencias)], puntos[numpy.argmax(sumas)], puntos[numpy.argmax(diferencias)]],
        dtype="float32",
    )


def enderezar(imagen_bgr):
    """Busca el contorno de 4 lados más grande (la hoja) y lo lleva a un rectángulo de tamaño fijo."""
    gris = cv2.cvtColor(imagen_bgr, cv2.COLOR_BGR2GRAY)
    bordes = cv2.Canny(cv2.GaussianBlur(gris, (5, 5), 0), 50, 150)
    bordes = cv2.dilate(bordes, numpy.ones((3, 3), numpy.uint8))
    contornos, _ = cv2.findContours(bordes, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area_minima = 0.2 * gris.shape[0] * gris.shape[1]
    for contorno in sorted(contornos, key=cv2.contourArea, reverse=True):
        if cv2.contourArea(contorno) < area_minima:
            break
        aproximado = cv2.approxPolyDP(contorno, 0.02 * cv2.arcLength(contorno, True), True)
        if len(aproximado) == 4:
            destino = numpy.array([[0, 0], [ANCHO_ENDEREZADO - 1, 0], [ANCHO_ENDEREZADO - 1, ALTO_ENDEREZADO - 1], [0, ALTO_ENDEREZADO - 1]], dtype="float32")
            matriz = cv2.getPerspectiveTransform(_ordenar_esquinas(aproximado), destino)
            return cv2.warpPerspective(imagen_bgr, matriz, (ANCHO_ENDEREZADO, ALTO_ENDEREZADO)), True
    return cv2.resize(imagen_bgr, (ANCHO_ENDEREZADO, ALTO_ENDEREZADO)), False


def huellas_perceptuales(imagen_bgr):
    enderezada, encontrada = enderezar(imagen_bgr)
    izquierda, arriba, derecha, abajo = ZONA_ESCRITA
    zona = enderezada[int(arriba * ALTO_ENDEREZADO) : int(abajo * ALTO_ENDEREZADO), int(izquierda * ANCHO_ENDEREZADO) : int(derecha * ANCHO_ENDEREZADO)]
    imagen = Image.fromarray(cv2.cvtColor(zona, cv2.COLOR_BGR2RGB))
    return {
        "average_hash": imagehash.average_hash(imagen, hash_size=TAMANO_HASH),
        "phash": imagehash.phash(imagen, hash_size=TAMANO_HASH),
        "hoja_encontrada": encontrada,
    }


def comparar(huellas_a, huellas_b):
    distancia_rapida = huellas_a["average_hash"] - huellas_b["average_hash"]
    distancia_fina = huellas_a["phash"] - huellas_b["phash"]
    return {
        "distancia_average_hash": int(distancia_rapida),
        "distancia_phash": int(distancia_fina),
        "posible_reciclada": bool(distancia_rapida <= UMBRAL_AVERAGE_HASH and distancia_fina <= UMBRAL_PHASH),
    }


def buscar_recicladas(fotos_por_mesa):
    """fotos_por_mesa: {mesa: imagen BGR}. Devuelve los pares de mesas cuyas fotos parecen la misma acta."""
    huellas = {mesa: huellas_perceptuales(imagen) for mesa, imagen in fotos_por_mesa.items()}
    sospechosas = []
    for mesa_a, mesa_b in combinations(sorted(huellas), 2):
        resultado = comparar(huellas[mesa_a], huellas[mesa_b])
        if resultado["posible_reciclada"]:
            sospechosas.append({"mesas": [mesa_a, mesa_b], **resultado})
    return sospechosas
