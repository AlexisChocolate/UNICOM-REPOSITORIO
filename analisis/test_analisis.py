import json
import pathlib
import unittest

import cv2
import numpy

import carril_a
import datos
import fotos_recicladas
import oneaudit
import umbral_lector

RAIZ = pathlib.Path(__file__).resolve().parent.parent


def mesas_de_puno(cantidad=300, semilla=7):
    generador = numpy.random.default_rng(semilla)
    mesas = []
    for numero in range(cantidad):
        electores = int(generador.integers(150, 300))
        votantes = int(generador.binomial(electores, 0.8))
        sol = int(generador.binomial(votantes, 0.52))
        rio = int(generador.binomial(votantes - sol, 0.85))
        resto = votantes - sol - rio
        blancos = resto // 2
        mesas.append(
            carril_a.Mesa(
                mesa=f"{45000 + numero:06d}",
                electores_habiles=electores,
                votos={"P01": sol, "P02": rio, "blancos": blancos, "nulos": resto - blancos, "impugnados": 0},
            )
        )
    return mesas


class PruebasCarrilA(unittest.TestCase):
    def test_ultimo_digito_de_conteos_honestos_no_se_marca(self):
        resultado = carril_a.prueba_ultimo_digito([mesa.votos["P01"] for mesa in mesas_de_puno()])
        self.assertTrue(resultado["aplicable"])
        self.assertGreater(resultado["valor_p"], 0.01)

    def test_ultimo_digito_inventado_con_ceros_y_cincos_se_marca(self):
        inventados = [120, 150, 100, 85, 90, 110, 95, 130, 140, 105] * 10
        self.assertLess(carril_a.prueba_ultimo_digito(inventados)["valor_p"], 0.001)

    def test_conteos_de_un_digito_no_se_usan(self):
        self.assertFalse(carril_a.prueba_ultimo_digito([1, 2, 3, 4, 5, 6, 7, 8, 9, 0])["aplicable"])

    def test_pares_de_digitos(self):
        resultado = carril_a.prueba_pares_de_digitos([mesa.votos["P02"] for mesa in mesas_de_puno()])
        self.assertTrue(resultado["aplicable"])
        self.assertGreater(resultado["valor_p_repetidos"], 0.01)

    def test_porcentajes_enteros_honestos_no_se_marcan(self):
        resultado = carril_a.prueba_porcentajes_enteros(mesas_de_puno(), "P01", simulaciones=500)
        self.assertTrue(resultado["aplicable"])
        self.assertGreater(resultado["valor_p"], 0.01)

    def test_porcentajes_enteros_fabricados_se_marcan(self):
        mesas = mesas_de_puno()
        for mesa in mesas[:60]:
            mesa.electores_habiles = 200
            mesa.votos = {"P01": 80, "P02": 60, "blancos": 10, "nulos": 10, "impugnados": 0}
        self.assertLess(carril_a.prueba_porcentajes_enteros(mesas, "P01", simulaciones=500)["valor_p"], 0.01)

    def test_huella_participacion_voto_cuenta_todas_las_mesas(self):
        huella = carril_a.huella_participacion_voto(mesas_de_puno(), "P01")
        self.assertEqual(sum(map(sum, huella["histograma"])), 300)

    def test_la_lista_pone_arriba_las_mesas_con_senales_y_explica_por_que(self):
        mesas = mesas_de_puno()
        mesas[10].marca_ia = "rojo"
        mesas[10].personeros_presentes = False
        mesas[20].electores_habiles = 200
        mesas[20].votos = {"P01": 199, "P02": 1, "blancos": 0, "nulos": 0, "impugnados": 0}
        lista = carril_a.lista_de_prioridad(mesas, "P01")
        self.assertEqual({lista[0]["mesa"], lista[1]["mesa"]}, {mesas[10].mesa, mesas[20].mesa})
        self.assertIn("sin personero", next(fila for fila in lista if fila["mesa"] == mesas[10].mesa)["razones"])


class PruebasOneAudit(unittest.TestCase):
    def test_el_muestreo_de_rivest_coincide_con_los_casos_publicos_y_con_javascript(self):
        casos = json.loads((RAIZ / "nucleo" / "pruebas" / "datos" / "rivest-sampler-tests.json").read_text(encoding="utf-8"))
        for caso in casos["tests"]:
            with self.subTest(caso["data"]["seed"]):
                self.assertEqual(oneaudit.muestra_rivest(caso["data"]["seed"], caso["data"]["total"], caso["data"]["count"]), caso["expected"])

    def lotes(self, mesas):
        return [oneaudit.Lote(mesa.mesa, mesa.votos) for mesa in mesas]

    def test_sin_errores_la_auditoria_confirma_y_un_margen_mayor_necesita_menos_cedulas(self):
        ajustada = self.lotes(mesas_de_puno(80))
        holgadas = []
        for mesa in mesas_de_puno(80):
            votos = dict(mesa.votos)
            pasan = votos["P02"] // 2
            votos["P01"] += pasan
            votos["P02"] -= pasan
            holgadas.append(oneaudit.Lote(mesa.mesa, votos))
        tamano_ajustada = oneaudit.tamano_de_muestra_esperado(ajustada, ["P01", "P02"], alfa=0.05, simulaciones=40)
        tamano_holgada = oneaudit.tamano_de_muestra_esperado(holgadas, ["P01", "P02"], alfa=0.05, simulaciones=40)
        self.assertEqual(tamano_holgada["sin_confirmar"], 0)
        self.assertLess(tamano_holgada["mediana"], tamano_ajustada["mediana"])

    def test_si_el_ganador_reportado_es_falso_casi_nunca_confirma(self):
        verdaderas = []
        reportadas = []
        for posicion, mesa in enumerate(mesas_de_puno(60)):
            votos = {"P01": 100, "P02": 104, "blancos": 4, "nulos": 2, "impugnados": 0}
            verdaderas.append(oneaudit.Lote(mesa.mesa, votos))
            if posicion < 20:
                votos = {"P01": 112, "P02": 92, "blancos": 4, "nulos": 2, "impugnados": 0}
            reportadas.append(oneaudit.Lote(mesa.mesa, votos))
        alfa = 0.05
        generador = numpy.random.default_rng(11)
        confirmadas = sum(
            oneaudit.simular_auditoria(reportadas, verdaderas, ["P01", "P02"], alfa, 3000, generador) is not None for _ in range(200)
        )
        self.assertLessEqual(confirmadas / 200, 2 * alfa)

    def test_las_cedulas_elegidas_estan_dentro_de_sus_sobres(self):
        lotes = self.lotes(mesas_de_puno(10))
        por_mesa = {lote.mesa: lote.cedulas for lote in lotes}
        for mesa, cedula in oneaudit.elegir_cedulas("semilla de prueba", lotes, 50):
            self.assertTrue(1 <= cedula <= por_mesa[mesa])


def acta_sintetica(votos_sol, votos_rio, angulo=0.0, perspectiva=0):
    hoja = numpy.full((1400, 1000, 3), 255, numpy.uint8)
    cv2.putText(hoja, "ACTA ELECTORAL MESA 045123", (60, 120), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 0), 3)
    for fila in range(6):
        cv2.line(hoja, (60, 300 + fila * 160), (940, 300 + fila * 160), (0, 0, 0), 3)
    cv2.putText(hoja, f"SOL {votos_sol}", (100, 420), cv2.FONT_HERSHEY_SIMPLEX, 4, (30, 30, 160), 10)
    cv2.putText(hoja, f"RIO {votos_rio}", (100, 740), cv2.FONT_HERSHEY_SIMPLEX, 4, (30, 30, 160), 10)
    cv2.circle(hoja, (700, 1100), 120 + votos_sol % 50, (0, 0, 0), 8)
    fondo = numpy.full((1800, 1400, 3), 40, numpy.uint8)
    origen = numpy.array([[0, 0], [999, 0], [999, 1399], [0, 1399]], dtype="float32")
    centro = numpy.array([700, 900], dtype="float32")
    radianes = numpy.deg2rad(angulo)
    giro = numpy.array([[numpy.cos(radianes), -numpy.sin(radianes)], [numpy.sin(radianes), numpy.cos(radianes)]], dtype="float32")
    esquinas = (origen - numpy.array([500, 700], dtype="float32")) @ giro.T + centro
    esquinas[0, 0] += perspectiva
    esquinas[1, 0] -= perspectiva
    matriz = cv2.getPerspectiveTransform(origen, esquinas.astype("float32"))
    return cv2.warpPerspective(hoja, matriz, (1400, 1800), dst=fondo, borderMode=cv2.BORDER_TRANSPARENT)


class PruebasFotosRecicladas(unittest.TestCase):
    def test_la_misma_acta_girada_5_grados_y_en_perspectiva_se_detecta(self):
        original = fotos_recicladas.huellas_perceptuales(acta_sintetica(120, 80))
        reciclada = fotos_recicladas.huellas_perceptuales(acta_sintetica(120, 80, angulo=5, perspectiva=40))
        self.assertTrue(original["hoja_encontrada"] and reciclada["hoja_encontrada"])
        self.assertTrue(fotos_recicladas.comparar(original, reciclada)["posible_reciclada"])

    def test_otra_acta_no_se_confunde(self):
        resultado = fotos_recicladas.buscar_recicladas({"045123": acta_sintetica(120, 80), "045124": acta_sintetica(77, 131, angulo=3)})
        self.assertEqual(resultado, [])


class PruebasUmbralLector(unittest.TestCase):
    def test_el_umbral_separa_aciertos_de_errores(self):
        filas = [(120, 120, 0.95)] * 40 + [(80, 80, 0.9)] * 30 + [(4, 5, 0.55)] * 5 + [(17, 817, 0.6)] * 2 + [(9, 4, 0.92)]
        mejor = umbral_lector.elegir_umbral(filas)
        self.assertGreater(mejor["umbral"], 0.6)
        self.assertLessEqual(mejor["umbral"], 0.9)
        self.assertEqual(mejor["aciertos_marcados"], 0)

    def test_tasa_de_error_con_intervalo(self):
        resultado = umbral_lector.tasa_de_error([(1, 1, 0.9)] * 97 + [(4, 9, 0.8)] * 3)
        self.assertAlmostEqual(resultado["tasa"], 0.03)
        self.assertLess(resultado["intervalo_95"][0], 0.03)
        self.assertGreater(resultado["intervalo_95"][1], 0.03)


class PruebasDatos(unittest.TestCase):
    def test_las_mesas_salen_de_la_ultima_acta_y_llevan_la_marca_de_la_ia(self):
        paquete = {"mesa": "045123", "votos": {"P01": 120, "P02": 80, "blancos": 6, "nulos": 4, "impugnados": 1}, "personeros_presentes": False}
        lectura = {categoria: {"valor": valor, "tachon": False, "confianza_milesimas": 950} for categoria, valor in paquete["votos"].items()}
        lectura["nulos"]["valor"] = 5
        renglones = [
            {"tipo": "acta", "contenido": {"paquete": paquete}},
            {"tipo": "lectura_ia", "contenido": {"mesa": "045123", "estado": "leida", "resultado": lectura}},
        ]
        [mesa] = datos.mesas_desde_cuaderno(renglones, {"045123": 260})
        self.assertEqual(mesa.marca_ia, "rojo")
        self.assertFalse(mesa.personeros_presentes)


if __name__ == "__main__":
    unittest.main()
