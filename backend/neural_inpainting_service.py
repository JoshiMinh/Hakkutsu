from __future__ import annotations

from threading import Lock

import cv2
import numpy as np
import torch

from backend.config import LAMA_ENABLED, LAMA_MODEL_PATH


_model: torch.jit.ScriptModule | None = None
_model_lock = Lock()


def lama_available() -> bool:
    return LAMA_ENABLED and LAMA_MODEL_PATH.is_file()


def _load_lama_model() -> torch.jit.ScriptModule:
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                if not lama_available():
                    raise RuntimeError("Model LaMa chưa được tải")
                # torch.jit.load cannot open a Unicode Windows path reliably.
                # Opening it in Python first keeps projects with Vietnamese
                # directory names working.
                with LAMA_MODEL_PATH.open("rb") as model_file:
                    loaded = torch.jit.load(model_file, map_location="cpu")
                loaded.eval()
                _model = loaded
    return _model


def _pad_to_modulo(array: np.ndarray, modulo: int = 8) -> np.ndarray:
    height, width = array.shape[-2:]
    target_height = ((height + modulo - 1) // modulo) * modulo
    target_width = ((width + modulo - 1) // modulo) * modulo
    padding = [(0, 0)] * array.ndim
    padding[-2] = (0, target_height - height)
    padding[-1] = (0, target_width - width)
    return np.pad(array, padding, mode="symmetric")


def lama_inpaint(rgb_image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Inpaint a stroke mask with the local big-LaMa TorchScript model."""
    if rgb_image.ndim != 3 or rgb_image.shape[2] != 3:
        raise ValueError("LaMa cần ảnh RGB")
    if mask.shape != rgb_image.shape[:2]:
        raise ValueError("Mask LaMa không khớp kích thước ảnh")
    if not np.any(mask):
        return rgb_image.copy()

    original_height, original_width = mask.shape
    image_chw = np.transpose(rgb_image.astype(np.float32) / 255.0, (2, 0, 1))
    mask_chw = (mask.astype(np.float32) / 255.0)[None, ...]
    image_chw = _pad_to_modulo(image_chw)
    mask_chw = _pad_to_modulo(mask_chw)
    image_tensor = torch.from_numpy(image_chw).unsqueeze(0)
    mask_tensor = (torch.from_numpy(mask_chw).unsqueeze(0) > 0).float()

    model = _load_lama_model()
    with _model_lock, torch.inference_mode():
        prediction = model(image_tensor, mask_tensor)
    generated = prediction[0].permute(1, 2, 0).detach().cpu().numpy()
    generated = np.clip(generated[:original_height, :original_width] * 255, 0, 255).astype(np.uint8)

    # Feather only the immediate mask boundary. Everything else remains bit
    # identical to the source page, preventing a neural model from subtly
    # changing faces or line art outside the Japanese glyphs.
    alpha = cv2.GaussianBlur(mask, (0, 0), 1.2).astype(np.float32) / 255.0
    alpha = np.clip(alpha, 0, 1)[..., None]
    blended = generated.astype(np.float32) * alpha + rgb_image.astype(np.float32) * (1 - alpha)
    return np.clip(blended, 0, 255).astype(np.uint8)
