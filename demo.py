import random

from unicom.acta import Acta
from unicom.merkle import raiz, prueba_inclusion, verificar_inclusion, merkle_diff
from unicom.sorteo import semilla_desde_bloque, seleccionar_mesas

LISTAS = ["Frente Universitario Altiplano", "Renovación Estudiantil", "Integración EPIS"]
TOTAL_MESAS = 1000


def generar_actas(cantidad: int) -> list:
    generador = random.Random(2026)
    actas = []
    for numero in range(cantidad):
        votos = {lista: generador.randint(20, 90) for lista in LISTAS}
        actas.append(Acta(
            codigo_mesa=f"UNAP-{numero + 1:04d}",
            local_votacion="Ciudad Universitaria, Puno",
            votos_por_lista=votos,
            votos_blancos=generador.randint(0, 10),
            votos_nulos=generador.randint(0, 8),
            electores_habiles=300,
        ))
    return actas


def main():
    actas = generar_actas(TOTAL_MESAS)
    hojas = [acta.serializar() for acta in actas]
    raiz_publicada = raiz(hojas)
    print(f"Actas comprometidas: {len(actas)}")
    print(f"Raíz de Merkle: {raiz_publicada.hex()}")

    indice_consulta = 417
    prueba = prueba_inclusion(hojas, indice_consulta)
    incluida = verificar_inclusion(hojas[indice_consulta], indice_consulta, len(hojas), prueba, raiz_publicada)
    print(f"Mesa {actas[indice_consulta].codigo_mesa} incluida en la raíz: {incluida} ({len(prueba)} hashes de prueba)")

    acta_original = actas[733]
    votos_alterados = dict(acta_original.votos_por_lista)
    votos_alterados["Renovación Estudiantil"] += 40
    actas_alteradas = list(actas)
    actas_alteradas[733] = Acta(**{**acta_original.__dict__, "votos_por_lista": votos_alterados})
    alterados, comparaciones = merkle_diff(hojas, [acta.serializar() for acta in actas_alteradas])
    print(f"Merkle-diff: acta alterada en mesa {actas[alterados[0]].codigo_mesa} tras {comparaciones} comparaciones")

    hash_bloque_simulado = "00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054"
    semilla = semilla_desde_bloque(hash_bloque_simulado, raiz_publicada.hex())
    muestra = seleccionar_mesas(semilla, TOTAL_MESAS, 10)
    print(f"Mesas sorteadas para auditoría: {', '.join(actas[indice].codigo_mesa for indice in muestra)}")


if __name__ == "__main__":
    main()
