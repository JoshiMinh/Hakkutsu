import os
import argparse
import mlflow
import numpy as np
from transformers import TrainingArguments, Trainer, DataCollatorWithPadding

from dataset import load_and_prepare_dataset
from model import get_model
from metrics import compute_metrics, plot_confusion_matrix

def parse_args():
    parser = argparse.ArgumentParser(description="Train JLPT Difficulty Classifier")
    parser.add_argument("--model_name", type=str, default="cl-tohoku/bert-base-japanese", help="Base model to fine-tune")
    parser.add_argument("--batch_size", type=int, default=16, help="Training batch size")
    parser.add_argument("--epochs", type=int, default=3, help="Number of training epochs")
    parser.add_argument("--learning_rate", type=float, default=2e-5, help="Learning rate")
    return parser.parse_args()

def main():
    args = parse_args()

    ml_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_path = os.path.join(ml_dir, "data", "processed", "jlpt_sentences.csv")
    output_dir = os.path.join(ml_dir, "models", "jlpt_classifier")
    logs_dir = os.path.join(ml_dir, "logs")

    # Set up MLflow
    mlruns_db = os.path.join(ml_dir, "mlflow.db")
    os.environ["MLFLOW_TRACKING_URI"] = f"sqlite:///{mlruns_db}"
    mlflow.set_experiment("jlpt-difficulty-classification")

    print("Loading dataset...")
    datasets, tokenizer = load_and_prepare_dataset(data_path, args.model_name)

    print("Loading model...")
    model = get_model(args.model_name)

    data_collator = DataCollatorWithPadding(tokenizer=tokenizer)

    training_args = TrainingArguments(
        output_dir=output_dir,
        eval_strategy="epoch",
        save_strategy="epoch",
        learning_rate=args.learning_rate,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        num_train_epochs=args.epochs,
        weight_decay=0.01,
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        logging_dir=logs_dir,
        report_to=["mlflow"], # Enable MLflow tracking
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=datasets["train"],
        eval_dataset=datasets["validation"],
        processing_class=tokenizer,
        data_collator=data_collator,
        compute_metrics=compute_metrics,
    )

    print("Starting training...")
    trainer.train()

    print("Evaluating on test set...")
    test_results = trainer.predict(datasets["test"])
    print("Test Metrics:", test_results.metrics)

    # Generate Confusion Matrix
    print("Generating Confusion Matrix...")
    y_true = datasets["test"]["label"]
    y_pred = np.argmax(test_results.predictions, axis=-1)
    
    plots_dir = os.path.join(ml_dir, "outputs")
    plot_confusion_matrix(y_true, y_pred, plots_dir)

    # Save final model
    print("Saving best model...")
    trainer.save_model(output_dir)
    print("Training complete! Model saved to:", output_dir)

if __name__ == "__main__":
    main()
