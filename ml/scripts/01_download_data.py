import os
import json
import requests
import pandas as pd
from datasets import load_dataset
from tqdm import tqdm

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
RAW_DIR = os.path.join(DATA_DIR, "raw")

os.makedirs(RAW_DIR, exist_ok=True)

def download_jlpt_vocab():
    print("Downloading JLPT Vocabulary...")
    vocab_url = "https://raw.githubusercontent.com/jamsinclair/open-jlpt-vocab/master/data/all-vocab.json"
    response = requests.get(vocab_url)
    vocab_path = os.path.join(RAW_DIR, "jlpt_vocab.json")
    if response.status_code == 200:
        with open(vocab_path, "w", encoding="utf-8") as f:
            f.write(response.text)
        print(f"Saved JLPT Vocab to {vocab_path}")
    else:
        print(f"Failed to download JLPT vocab (Status: {response.status_code}). Generating a fallback vocabulary file for testing...")
        mock_vocab = [
            {"word": "私", "level": 5}, {"word": "食べる", "level": 5}, {"word": "学校", "level": 5},
            {"word": "勉強", "level": 5}, {"word": "時間", "level": 4}, {"word": "電話", "level": 4},
            {"word": "経済", "level": 3}, {"word": "政治", "level": 2}, {"word": "難解", "level": 1},
            {"word": "猫", "level": 4}, {"word": "犬", "level": 4}, {"word": "自動車", "level": 4},
            {"word": "社会", "level": 3}, {"word": "環境", "level": 2}, {"word": "宇宙", "level": 1},
            {"word": "the", "level": 5}, {"word": "is", "level": 5} # Dummy for english overlap tokens if any
        ]
        with open(vocab_path, "w", encoding="utf-8") as f:
            json.dump(mock_vocab, f, ensure_ascii=False, indent=2)
        print(f"Saved fallback JLPT Vocab to {vocab_path}")

def download_tatoeba_sentences():
    print("Downloading English-Japanese sentences via Hugging Face...")
    try:
        # Load Opus-100 dataset from huggingface datasets as a Tatoeba alternative
        dataset = load_dataset("Helsinki-NLP/opus-100", "en-ja", split="train")
        print(f"Loaded {len(dataset)} sentences.")
        
        # Take a subset of 50,000 sentences for manageable EDA and processing
        # Increase this number later for full model training
        subset = dataset.select(range(min(50000, len(dataset))))
        
        en_sentences = [item['en'] for item in subset['translation']]
        ja_sentences = [item['ja'] for item in subset['translation']]
        
        df = pd.DataFrame({
            "english": en_sentences,
            "japanese": ja_sentences
        })
        
        csv_path = os.path.join(RAW_DIR, "tatoeba_sentences.csv")
        df.to_csv(csv_path, index=False, encoding="utf-8")
        print(f"Saved sentences to {csv_path}")
    except Exception as e:
        print(f"Error downloading from Hugging Face: {e}")
        print("Generating a fallback sentences dataset for testing...")
        mock_sentences = [
            {"english": "I eat an apple.", "japanese": "私はりんごを食べる。"},
            {"english": "I go to school.", "japanese": "私は学校に行く。"},
            {"english": "It is difficult.", "japanese": "それは難解だ。"},
            {"english": "Politics and economics.", "japanese": "政治と経済。"},
            {"english": "The cat is cute.", "japanese": "猫はかわいい。"},
            {"english": "Protect the global environment.", "japanese": "地球環境を守る。"}
        ]
        df = pd.DataFrame(mock_sentences)
        csv_path = os.path.join(RAW_DIR, "tatoeba_sentences.csv")
        df.to_csv(csv_path, index=False, encoding="utf-8")
        print(f"Saved fallback sentences to {csv_path}")

if __name__ == "__main__":
    download_jlpt_vocab()
    download_tatoeba_sentences()
    print("Download complete.")
