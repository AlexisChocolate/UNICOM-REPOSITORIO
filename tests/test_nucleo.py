import unittest

from unicom.merkle import raiz, prueba_inclusion, verificar_inclusion, merkle_diff
from unicom.sorteo import seleccionar_mesas


class PruebasMerkle(unittest.TestCase):
    def setUp(self):
        self.hojas = [f"acta-mesa-{numero:04d}".encode() for numero in range(37)]

    def test_toda_acta_tiene_prueba_valida(self):
        raiz_publicada = raiz(self.hojas)
        for indice, hoja in enumerate(self.hojas):
            prueba = prueba_inclusion(self.hojas, indice)
            self.assertTrue(verificar_inclusion(hoja, indice, len(self.hojas), prueba, raiz_publicada))

    def test_acta_alterada_no_verifica(self):
        raiz_publicada = raiz(self.hojas)
        prueba = prueba_inclusion(self.hojas, 5)
        self.assertFalse(verificar_inclusion(b"acta-mesa-0005-alterada", 5, len(self.hojas), prueba, raiz_publicada))

    def test_merkle_diff_localiza_alteraciones(self):
        auditadas = list(self.hojas)
        auditadas[3] = b"alterada"
        auditadas[30] = b"alterada"
        alterados, _ = merkle_diff(self.hojas, auditadas)
        self.assertEqual(alterados, [3, 30])


class PruebasSorteo(unittest.TestCase):
    def test_sorteo_es_reproducible_y_sin_repeticiones(self):
        semilla = b"semilla-de-bloque"
        primera = seleccionar_mesas(semilla, 500, 20)
        self.assertEqual(primera, seleccionar_mesas(semilla, 500, 20))
        self.assertEqual(len(set(primera)), 20)


if __name__ == "__main__":
    unittest.main()
