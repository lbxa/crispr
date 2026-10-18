"""The CRISPRon deep-learning ensemble: Keras SavedModels run on s390x TensorFlow 2.4.1."""

import glob
import os
from typing import Callable, Dict, List

from .encoding import one_hot
from .thermo import energies as crisproff_energies


class Ensemble:
    """Equal-weight mean over every SavedModel directory, as in upstream DeepCRISPRon_eval.py."""

    def __init__(
        self, model_dirs: List[str], energies: Callable[[List[str]], List[Dict[str, float]]] = crisproff_energies
    ):
        import tensorflow as tf  # only present in the TensorFlow container

        if not model_dirs:
            raise RuntimeError("no SavedModel directories found")
        self._energies = energies
        self.names = [os.path.basename(path.rstrip("/")) for path in model_dirs]
        self._models = [tf.keras.models.load_model(path) for path in model_dirs]

    def predict(self, contexts: List[str]) -> List[dict]:
        """Per guide: the ensemble mean, each model's own prediction, and the CRISPRoff energy terms."""
        import numpy as np  # pyright: ignore[reportMissingImports]  (TensorFlow container only)

        terms = self._energies(contexts)
        onehot = np.asarray(one_hot(contexts), dtype=np.float32)  # [batch, 30, 4]
        dg = np.asarray([t["crisproff_score"] for t in terms], dtype=np.float32).reshape(-1, 1)  # [batch, 1]
        inputs = {"input_onehot": onehot, "input_dGB": dg}
        per_model = np.stack([np.asarray(m.predict(inputs)).reshape(-1) for m in self._models])  # [models, batch]
        mean = per_model.mean(axis=0)
        return [
            {
                "efficiency": float(mean[i]),
                "models": {name: float(per_model[j][i]) for j, name in enumerate(self.names)},
                "energy": terms[i],
            }
            for i in range(len(contexts))
        ]


def find_model_dirs() -> List[str]:
    pattern = os.environ.get("CRISPRON_MODELS") or os.path.join(
        os.environ["CRISPRON_DIR"], "data", "deep_models", "best", "*"
    )
    return sorted(path for path in glob.glob(pattern) if os.path.isdir(path))
