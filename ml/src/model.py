from transformers import AutoModelForSequenceClassification

def get_model(model_name: str, num_labels: int = 5) -> AutoModelForSequenceClassification:
    """
    Loads the pre-trained sequence classification model.
    """
    model = AutoModelForSequenceClassification.from_pretrained(
        model_name,
        num_labels=num_labels,
        id2label={0: "N1", 1: "N2", 2: "N3", 3: "N4", 4: "N5"},
        label2id={"N1": 0, "N2": 1, "N3": 2, "N4": 3, "N5": 4}
    )
    return model
