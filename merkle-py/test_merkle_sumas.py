import json
import pathlib
import unittest

import merkle_sumas

VECTORES = json.loads((pathlib.Path(__file__).parent / "vectores.json").read_text(encoding="utf-8"))
CATEGORIAS = len(VECTORES["categorias"])


def nodo_desde_json(dato):
    return merkle_sumas.Nodo(bytes.fromhex(dato["huella"]), tuple(dato["sumas"]))


class PruebasContraJavaScript(unittest.TestCase):
    def test_los_vacios_por_nivel_coinciden(self):
        vacios = merkle_sumas.vacios_por_nivel(CATEGORIAS)
        self.assertEqual([nodo_desde_json(vacio) for vacio in VECTORES["vacios"]], vacios)

    def test_cada_raiz_coincide_con_la_de_javascript(self):
        for vector in VECTORES["vectores"]:
            with self.subTest(vector["nombre"]):
                hojas = [(hoja["casillero"], hoja["huella_acta"], tuple(hoja["sumas"])) for hoja in vector["hojas"]]
                self.assertEqual(merkle_sumas.raiz(hojas, CATEGORIAS), nodo_desde_json(vector["raiz"]))

    def test_la_prueba_de_inclusion_de_javascript_se_verifica_en_python(self):
        for vector in VECTORES["vectores"]:
            if vector["prueba"] is None:
                continue
            with self.subTest(vector["nombre"]):
                hoja = vector["hojas"][0]
                hermanos = [nodo_desde_json(hermano) for hermano in vector["prueba"]["hermanos"]]
                raiz = nodo_desde_json(vector["raiz"])
                self.assertTrue(merkle_sumas.verificar_inclusion(hoja["casillero"], hoja["huella_acta"], tuple(hoja["sumas"]), hermanos, raiz))
                alteradas = (hoja["sumas"][0] + 30,) + tuple(hoja["sumas"][1:])
                self.assertFalse(merkle_sumas.verificar_inclusion(hoja["casillero"], hoja["huella_acta"], alteradas, hermanos, raiz))


class PruebasPropias(unittest.TestCase):
    def test_la_hoja_lleva_el_casillero(self):
        huella = "ab" * 32
        self.assertNotEqual(merkle_sumas.hoja_llena(45123, huella, (1, 2)), merkle_sumas.hoja_llena(45124, huella, (1, 2)))

    def test_rechaza_votos_negativos(self):
        with self.assertRaises(ValueError):
            merkle_sumas.hoja_llena(45123, "ab" * 32, (-1, 2))

    def test_la_prueba_propia_de_la_mesa_045123(self):
        hojas = [(45123, "cd" * 32, (120, 80)), (45124, "ef" * 32, (77, 131))]
        niveles = merkle_sumas.construir_tablero(hojas, 2)
        raiz = niveles[merkle_sumas.NIVELES][0]
        self.assertEqual(raiz.sumas, (197, 211))
        hermanos = merkle_sumas.prueba_inclusion(niveles, 45123, 2)
        self.assertTrue(merkle_sumas.verificar_inclusion(45123, "cd" * 32, (120, 80), hermanos, raiz))


if __name__ == "__main__":
    unittest.main()
