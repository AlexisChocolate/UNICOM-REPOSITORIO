"""Informe del Carril A y tamaño de muestra del Carril B con los datos públicos de UNICOM.

    python analisis/informe.py --electores electores.csv [--api URL] [--alfa 0.05]

electores.csv: columnas mesa,electores_habiles (de los datos por mesa que publica la ONPE).
Los dos carriles se calculan por separado: la lista de prioridad no entra al sorteo (regla 5).
"""

import argparse
import json

import carril_a
import datos
import oneaudit


def principal():
    analizador = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("--electores", required=True)
    analizador.add_argument("--api", default=datos.DIRECCION_API)
    analizador.add_argument("--alfa", type=float, default=0.05)
    opciones = analizador.parse_args()

    mesas = datos.mesas_desde_cuaderno(datos.renglones_del_cuaderno(opciones.api), datos.electores_desde_csv(opciones.electores))
    if not mesas:
        print("No hay mesas con acta y electores hábiles conocidos.")
        return
    lotes = [oneaudit.Lote(mesa.mesa, mesa.votos) for mesa in mesas]
    ganador, totales = oneaudit.ganador_reportado(lotes)
    partidos = sorted(categoria for categoria in totales if categoria.startswith("P"))

    print(f"Mesas analizadas: {len(mesas)} · ganador reportado: {ganador} · totales: {json.dumps(totales)}")
    print("Carril A (señala, no acusa):")
    print(f"  último dígito: {json.dumps(carril_a.prueba_ultimo_digito([mesa.votos[ganador] for mesa in mesas]))}")
    print(f"  pares de dígitos: {json.dumps(carril_a.prueba_pares_de_digitos([mesa.votos[ganador] for mesa in mesas]))}")
    print(f"  porcentajes enteros: {json.dumps(carril_a.prueba_porcentajes_enteros(mesas, ganador))}")
    for fila in carril_a.lista_de_prioridad(mesas, ganador)[:20]:
        if fila["puntaje"] > 0:
            print(f"  mesa {fila['mesa']}: puntaje {fila['puntaje']} · {'; '.join(fila['razones'])}")
    print(f"Carril B (ONEAudit, riesgo {opciones.alfa}):")
    print(f"  cédulas a revisar si los subtotales son correctos: {json.dumps(oneaudit.tamano_de_muestra_esperado(lotes, partidos, opciones.alfa))}")


if __name__ == "__main__":
    principal()
