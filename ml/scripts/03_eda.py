import os
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
PROCESSED_DIR = os.path.join(DATA_DIR, "processed")
EDA_DIR = os.path.join(DATA_DIR, "eda")

os.makedirs(EDA_DIR, exist_ok=True)

def run_eda():
    csv_path = os.path.join(PROCESSED_DIR, "jlpt_sentences.csv")
    if not os.path.exists(csv_path):
        print(f"File not found: {csv_path}. Run preprocessing first.")
        return
        
    print("Loading processed data for EDA...")
    df = pd.read_csv(csv_path)
    
    print("Generating distribution of JLPT levels...")
    plt.figure(figsize=(8, 5))
    sns.countplot(data=df, x="jlpt_level", hue="jlpt_level", order=["N5", "N4", "N3", "N2", "N1"], palette="viridis", legend=False)
    plt.title("Distribution of Sentences by JLPT Level")
    plt.xlabel("JLPT Level")
    plt.ylabel("Count")
    plt.tight_layout()
    plt.savefig(os.path.join(EDA_DIR, "level_distribution.png"))
    plt.close()
    
    print("Calculating sentence lengths...")
    df['char_length'] = df['japanese'].apply(lambda x: len(str(x)))
    
    plt.figure(figsize=(10, 6))
    sns.boxplot(data=df, x="jlpt_level", y="char_length", hue="jlpt_level", order=["N5", "N4", "N3", "N2", "N1"], palette="viridis", legend=False)
    plt.title("Sentence Length Distribution by JLPT Level")
    plt.xlabel("JLPT Level")
    plt.ylabel("Character Length")
    plt.tight_layout()
    plt.savefig(os.path.join(EDA_DIR, "length_distribution.png"))
    plt.close()
    
    print(f"EDA complete. Check the '{EDA_DIR}' folder for plots.")
    print("Summary Stats:")
    print(df['jlpt_level'].value_counts().sort_index(ascending=False))

if __name__ == "__main__":
    run_eda()
