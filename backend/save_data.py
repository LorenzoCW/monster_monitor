from dotenv import load_dotenv
from google.cloud import firestore
from apify_client import ApifyClient
import tempfile
import pytz
import os
import re
import time
import logging
import datetime

# Configurações
debug = False
debug_time = 2

TIMEZONE = pytz.timezone("America/Sao_Paulo")
TODAY_STRING = ""

logging.basicConfig(level=logging.INFO,
    format='%(asctime)s - %(message)s',
        handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger()

def message(text, forced=False):
    if debug or forced:
        logger.info(text)
    if debug:
        time.sleep(debug_time)
    return text


# -- init --
def set_day():
    message("Definindo data atual...")
    global TODAY_STRING
    today = datetime.datetime.now(TIMEZONE)
    TODAY_STRING = today.strftime('%Y-%m-%d')

def load_keys():
    message("Carregando variáveis secretas...")
    
    load_dotenv()
    client_token = os.getenv('CLIENT_TOKEN')
    task_id = os.getenv('TASK_ID')
    firebase_credentials_path = os.getenv('FIREBASE_CREDENTIALS_PATH')

    return client_token, task_id, firebase_credentials_path

def check_environment(firebase_credentials_info):
    message("Checando se a info é caminho (arquivo local) ou info json (variável secreta)")

    try:
        if os.path.exists(firebase_credentials_info):
            message(f"Credenciais encontradas localmente no arquivo '{firebase_credentials_info}'.")
            return firebase_credentials_info
    except Exception as e:
        message(f"Erro ao verificar o arquivo local: {str(e)}")
    
    message(f"Não foi possível obter credenciais em um arquivo local, buscando na variável secreta...")
    try:
        fd, temp_firebase_credentials_path = tempfile.mkstemp(prefix="firebase_", suffix=".json")
        with os.fdopen(fd, "w") as f:
            f.write(firebase_credentials_info)
        message(f"Arquivo temporário com as credenciais criado em: '{temp_firebase_credentials_path}'.")
        return temp_firebase_credentials_path
    except Exception as e:
        message(f"Erro ao definir variável: {str(e)}")
    
    return

def init_firestore(firebase_credentials_path):
    message("Conectando ao Firestore...")

    try:
        db = firestore.Client.from_service_account_json(firebase_credentials_path)
        message("Conexão ao Firestore estabelecida.")
    except Exception as e:
        message(f"Erro ao conectar no Firestore: {str(e)}")
        return

    return db


# -- uploads --
def upload_data(db, results):
    message(f"Salvando dados para {TODAY_STRING}...")

    try:
        doc_ref = db.collection("monster_data").document(TODAY_STRING)
        data_to_save = {}
        for result in results:
            key = f"preço_{result['source']}"
            data_to_save[key] = result["lowest_price"]

        doc_ref.set(data_to_save, merge=True)
        return message(f"Dados para {TODAY_STRING} salvos.", True)
    
    except Exception as e:
        message(f"Erro ao salvar dados: {str(e)}", True)
        return

def upload_status(db, title, status):
    message(f"Salvando status '{title}'...")

    try:
        last_title = title + "_timestamp"

        timestamp = datetime.datetime.now(TIMEZONE)
        formatted_time = timestamp.strftime('%d/%m/%Y %H:%M:%S')

        doc_ref = db.collection("status").document("monster_status")
        doc_ref.set({
            title: status,
            last_title: formatted_time
        }, merge=True)
        message(f"Status salvo.")

    except Exception as e:
        message(f"Erro ao salvar status: {str(e)}")

def upload_calc(db, collection, document, title, data):
    message(f"Salvando '{title}' em '{collection}/{document}'...")

    try:
        doc_ref = db.collection(collection).document(document)
        doc_ref.set({
            title: data
        }, merge=True)
        message(f"Dados '{title}' salvos no Firestore.")

    except Exception as e:
        message(f"Erro salvar dados '{title}': {str(e)}")


# -- scrape and save --
def check_data(db):
    message("Verificando se há dados existentes...")

    try:
        doc_ref = db.collection("monster_data").document(TODAY_STRING)
        doc = doc_ref.get()
        if not doc.exists:  # Não há dados o dia atual
            return message("Dados ainda não inseridos no banco.")
        
        info_message = message(f"Dados para {TODAY_STRING} já salvos.", True)
        upload_status(db, "final_result", info_message)
        return
    
    except Exception as e:
        error_message = message(f"Erro ao verificar os dados: {str(e)}", True)
        upload_status(db, "final_result", error_message)
        return

def scrape_data(client_token, task_id):
    message("Extraindo dados com Apify...")

    try:
        message("Conectando ao cliente...")
        client = ApifyClient(client_token)
        message("Cliente conectado.")

        message("Executando tarefa...")
        run = client.task(task_id).call()
        message("Tarefa finalizada.")

        message("Organizando dados...")
        results = []
        for item in client.dataset(run["defaultDatasetId"]).iterate_items():
            message("Item do dataset:")
            message(item)
            prices = extract_prices(item)
            message("Preços extraídos:")
            message(prices)
            if prices:
                lowest_price = min(prices)
                message("Preço selecionado:")
                message(lowest_price)
                results.append({"source": item["source"], "lowest_price": lowest_price})
                message("Resultado atual:")
                message(results)

        return results

    except Exception as e:
        message(f"Erro ao buscar dados: {str(e)}", True)
        return

def extract_prices(item):
    message("Verificando se a resposta é válida...")
    if "#error" in item and not item["#error"] and "prices" in item:
        message("Convertendo valores...")
        raw_prices = item["prices"]
        prices = []
        for price in raw_prices:
            match = re.search(r"(\d+[.,]\d+)", price)
            if match:
                cleaned_price = match.group(1).replace(",", ".")
                message(f"Convertido texto '{price}' para decimal '{cleaned_price}'")
                prices.append(float(cleaned_price))
        return prices

    message("A resposta não é válida.")
    return []


# -- parse and save data --
def fetch_data(db):
    message("Buscando dados no Firestore...")
    
    try:
        collection_ref = db.collection("monster_data")
        docs = collection_ref.stream()

        data = []
        for doc in docs:
            doc_data = doc.to_dict()
            data.append({
                "date": doc.id,
                "preço_Avenida": doc_data.get("preço_Avenida"),
                "preço_Central": doc_data.get("preço_Central"),
                "preço_Neto": doc_data.get("preço_Neto"),
                "preço_Open": doc_data.get("preço_Open")
            })

        if not data:
            message("Nenhum dado encontrado na coleção.")
            return

        # Ordena cronologicamente pelos IDs (datas)
        data.sort(key=lambda x: datetime.datetime.strptime(x["date"], "%Y-%m-%d"))

        # Forward-fill: preenche valores ausentes com o último valor conhecido
        last_values = {}
        for row in data:
            for key in ["preço_Avenida", "preço_Central", "preço_Neto", "preço_Open"]:
                if row[key] is None:
                    # se não houver valor atual, usa o último
                    row[key] = last_values.get(key)
                else:
                    # atualiza último valor conhecido
                    last_values[key] = row[key]

        message(f"{len(data)} registros encontrados e valores forward-filled.")
        return data

    except Exception as e:
        error_message = message(f"Erro ao buscar os dados: {str(e)}", True)
        upload_status(db, "final_result", error_message)
        return

def parse_data(data):
    message("Separando dados...")

    preço_Avenida = [{"x": item["date"], "y": item["preço_Avenida"]} for item in data]
    preço_Central = [{"x": item["date"], "y": item["preço_Central"]} for item in data]
    preço_Neto = [{"x": item["date"], "y": item["preço_Neto"]} for item in data]
    preço_Open = [{"x": item["date"], "y": item["preço_Open"]} for item in data]

    # preprocessed_full_data = {
    #     "price_points_Avenida": preço_Avenida,
    #     "price_points_Central": preço_Central,
    #     "price_points_Neto": preço_Neto,
    #     "price_points_Open": preço_Open
    # }

    preprocessed_month_data = {
        "price_points_Avenida": preço_Avenida[-28:],
        "price_points_Central": preço_Central[-28:],
        "price_points_Neto": preço_Neto[-28:],
        "price_points_Open": preço_Open[-28:]
    }

    message("Dados pré-processados.")
    return preprocessed_month_data


# -- calc and save data --
def recurring_price(data, title):
    message(f"Calculando valor mais recorrente e atual para {title}...")

    count = {}
    for item in data:
        if item in count:
            count[item] += 1
        else:
            count[item] = 1
    
    most_frequent = None
    highest_count = 0
    for price, quantity in count.items():
        if quantity > highest_count:
            highest_count = quantity
            most_frequent = price
    
    last_price = data[-1] if data else None
    return {
        "recurring_price": most_frequent,
        "last_price": last_price,
    }

def load_change_indicator(frequent_price, last_price, title):
    message(f"Calculando indicador de mudança para {title}...")
    
    if last_price > frequent_price:
        return "↑"
    elif last_price < frequent_price:
        return "↓"
    return ""


# -- main functions --
def init():

    message("Iniciando paramêtros do script...")

    # Inicializa data do dia atual
    set_day()

    client_token, task_id, firebase_credentials_path = load_keys()

    # Definir ambiente
    firebase_credentials_path = check_environment(firebase_credentials_path)
    if not firebase_credentials_path:
        message("Execução finalizada com falha.", True)
        return None, None, None

    # Faz a conexão com o firebase
    db = init_firestore(firebase_credentials_path)
    if not db:
        message("Execução finalizada com falha.", True)
        return None, None, None

    message("Paramêtros inicializados.")
    return client_token, task_id, db

def scrape_and_save(db, client_token, task_id):
    message("Iniciando coleta e salvamento de dados...")

    # Checa no firebase se já tem dados para hoje
    data_checked = check_data(db)
    if not data_checked: return

    # Coleta dados de preços
    price_results = scrape_data(client_token, task_id)
    if not price_results: return

    # Salva os dados no firebase
    data_uploaded = upload_data(db, price_results)
    if not data_uploaded: return

    # Salva o status de resultado final
    upload_status(db, "final_result", data_uploaded)
    return message("Fluxo de coletar e salvar dados finalizado.")

def parse_and_save_data(db):
    message("Iniciando salvamento de lista de pontos...")
    
    data = fetch_data(db)
    if not data: return

    month_data = parse_data(data)
    
    upload_calc(db, "parsed_data", "points_array", "month_data", month_data)
    # upload_calc(db, "parsed_data", "points_array", "full_data", full_data)
    
    message("Fluxo de salvar lista de pontos finalizado.")
    return month_data

def calc_and_save_data(db, data):
    message("Iniciando salvamento dos cálculos...")

    # Pega os pontos
    price_points_Avenida = data["price_points_Avenida"]
    price_points_Central = data["price_points_Central"]
    price_points_Neto = data["price_points_Neto"]
    price_points_Open = data["price_points_Open"]

    # Pega os preços
    preços_Avenida = [pt["y"] for pt in price_points_Avenida]
    preços_Central = [pt["y"] for pt in price_points_Central]
    preços_Neto = [pt["y"] for pt in price_points_Neto]
    preços_Open = [pt["y"] for pt in price_points_Open]

    # Calcula os preços normais
    price_changes_Avenida = recurring_price(preços_Avenida, "Avenida")
    price_changes_Central = recurring_price(preços_Central, "Central")
    price_changes_Neto = recurring_price(preços_Neto, "Neto")
    price_changes_Open = recurring_price(preços_Open, "Open")
    
    # Calcula o indicador de mudança
    price_changes_Avenida["change_indicator"] = load_change_indicator(price_changes_Avenida["recurring_price"], price_changes_Avenida["last_price"], "Avenida")
    price_changes_Central["change_indicator"] = load_change_indicator(price_changes_Central["recurring_price"], price_changes_Central["last_price"], "Central")
    price_changes_Neto["change_indicator"] = load_change_indicator(price_changes_Neto["recurring_price"], price_changes_Neto["last_price"], "Neto")
    price_changes_Open["change_indicator"] = load_change_indicator(price_changes_Open["recurring_price"], price_changes_Open["last_price"], "Open")

    # Upload dos cálculos
    upload_calc(db, "parsed_data", "calcs", "Avenida_changes", price_changes_Avenida)
    upload_calc(db, "parsed_data", "calcs", "Central_changes", price_changes_Central)
    upload_calc(db, "parsed_data", "calcs", "Neto_changes", price_changes_Neto)
    upload_calc(db, "parsed_data", "calcs", "Open_changes", price_changes_Open)

    message("Fluxo de salvar cálculos finalizado.")

def main():

    message("Iniciando script...\n", True)

    client_token, task_id, db = init()
    if not client_token or not task_id or not db: return

    response = scrape_and_save(db, client_token, task_id)
    if not response: return

    data = parse_and_save_data(db)
    if not data: return

    calc_and_save_data(db, data)

    message("Script finalizado.\n", True)

if __name__ == "__main__":
    main()