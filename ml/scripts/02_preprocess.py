import os
import json
import pandas as pd
from sudachipy import tokenizer, dictionary
from tqdm import tqdm

tqdm.pandas()

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
RAW_DIR = os.path.join(DATA_DIR, "raw")
PROCESSED_DIR = os.path.join(DATA_DIR, "processed")

os.makedirs(PROCESSED_DIR, exist_ok=True)

def load_jlpt_vocab():
    vocab_path = os.path.join(RAW_DIR, "jlpt_vocab.json")
    with open(vocab_path, "r", encoding="utf-8") as f:
        vocab_data = json.load(f)
    
    word_to_level = {}
    
    if isinstance(vocab_data, dict) and "words" in vocab_data:
        vocab_data = vocab_data["words"]
        
    if isinstance(vocab_data, list):
        for item in vocab_data:
            # Different repos have different keys. Try a few common ones.
            word = item.get("word") or item.get("slug") or item.get("kanji")
            if not word and item.get("japanese"):
                ja = item.get("japanese")
                if isinstance(ja, list) and len(ja) > 0:
                    word = ja[0].get("word") or ja[0].get("reading")
            
            level_raw = item.get("level") or item.get("jlpt") or item.get("n")
            
            if word and level_raw is not None:
                try:
                    if isinstance(level_raw, str):
                        level = int(level_raw.replace("N", "").replace("n", ""))
                    else:
                        level = int(level_raw)
                        
                    if word in word_to_level:
                        word_to_level[word] = min(word_to_level[word], level)
                    else:
                        word_to_level[word] = level
                except ValueError:
                    pass
    return word_to_level

def preprocess():
    print("Loading datasets...")
    df = pd.read_csv(os.path.join(RAW_DIR, "tatoeba_sentences.csv"))
    jlpt_vocab = load_jlpt_vocab()
    
    print(f"Loaded {len(jlpt_vocab)} JLPT vocabulary words.")
    
    print("Initializing SudachiPy tokenizer...")
    tokenizer_obj = dictionary.Dictionary().create()
    mode = tokenizer.Tokenizer.SplitMode.C
    
    def get_jlpt_level(text):
        try:
            tokens = tokenizer_obj.tokenize(str(text), mode)
            words = [m.dictionary_form() for m in tokens]
            
            hardest_level = 6
            for w in words:
                if w in jlpt_vocab:
                    hardest_level = min(hardest_level, jlpt_vocab[w])
            
            return f"N{hardest_level}" if hardest_level <= 5 else "Unclassified"
        except Exception:
            return "Unclassified"

    print("Tagging sentences with JLPT levels...")
    df['jlpt_level'] = df['japanese'].progress_apply(get_jlpt_level)
    
    df_filtered = df[df['jlpt_level'] != "Unclassified"]
    print(f"Kept {len(df_filtered)} sentences after filtering unclassified out of {len(df)}.")
    
    output_path = os.path.join(PROCESSED_DIR, "jlpt_sentences.csv")
    df_filtered.to_csv(output_path, index=False, encoding="utf-8")
    print(f"Saved processed data to {output_path}")

if __name__ == "__main__":
    preprocess()
