import os
import pandas as pd
from datasets import Dataset, DatasetDict
from transformers import AutoTokenizer

def load_and_prepare_dataset(csv_path: str, model_name: str, test_size: float = 0.2, seed: int = 42) -> tuple[DatasetDict, AutoTokenizer]:
    """
    Loads the processed CSV dataset, maps labels to IDs, 
    tokenizes the text, and splits into train/val/test.
    """
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"Dataset not found at {csv_path}")

    # Load data
    df = pd.read_csv(csv_path)

    # Label mapping (N1 to N5)
    # 0 = N1, 1 = N2, 2 = N3, 3 = N4, 4 = N5
    label_map = {"N1": 0, "N2": 1, "N3": 2, "N4": 3, "N5": 4}
    df['label'] = df['jlpt_level'].map(label_map)

    # Drop any unmapped or missing labels just in case
    df = df.dropna(subset=['label'])
    df['label'] = df['label'].astype(int)

    # Convert to Hugging Face Dataset
    dataset = Dataset.from_pandas(df[['japanese', 'label']])

    # Split dataset: 80% train, 20% test
    # Then split test into 50% val, 50% test (so 80/10/10 overall)
    train_test_split = dataset.train_test_split(test_size=test_size, seed=seed)
    test_val_split = train_test_split['test'].train_test_split(test_size=0.5, seed=seed)

    datasets = DatasetDict({
        'train': train_test_split['train'],
        'validation': test_val_split['train'],
        'test': test_val_split['test']
    })

    # Tokenizer
    tokenizer = AutoTokenizer.from_pretrained(model_name)

    def tokenize_function(examples):
        return tokenizer(examples['japanese'], padding="max_length", truncation=True, max_length=128)

    tokenized_datasets = datasets.map(tokenize_function, batched=True)

    return tokenized_datasets, tokenizer
