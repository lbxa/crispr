"""The CRISPRon deep-learning ensemble: Keras SavedModels run on s390x TensorFlow 2.4.1."""

import glob
import os
from typing import Callable, Dict, List

from .encoding import one_hot
from .thermo import energies as crisproff_energies


def load_model(path: str) -> Callable[[dict], object]:
    """A callable mapping {"input_onehot", "input_dGB"} arrays to predictions.

    TensorFlow 2.4.1 loads these Keras SavedModels directly. Newer TensorFlow (the 2.18 image on
    the LinuxONE server) cannot restore their saved optimizer state, so there the serving
    signature is run through the graph-mode loader, which ignores it; the outputs are identical.
    """
    import tensorflow as tf

    try:
        model = tf.keras.models.load_model(path)
        return lambda inputs: model.predict(inputs)
    except Exception:  # noqa: BLE001 - any load failure falls back to the signature loader
        pass
    graph = tf.Graph()
    session = tf.compat.v1.Session(graph=graph)
    with graph.as_default():
        meta = tf.compat.v1.saved_model.loader.load(session, ["serve"], path)
    signature = meta.signature_def["serving_default"]
    feeds = {key: graph.get_tensor_by_name(value.name) for key, value in signature.inputs.items()}
    fetch = [graph.get_tensor_by_name(value.name) for value in signature.outputs.values()][0]

    def run(inputs: dict) -> object:
        return session.run(fetch, {feeds[key]: inputs[key] for key in feeds})

    return run


class Ensemble:
    """Equal-weight mean over every SavedModel directory, as in upstream DeepCRISPRon_eval.py."""

    def __init__(
        self, model_dirs: List[str], energies: Callable[[List[str]], List[Dict[str, float]]] = crisproff_energies
    ):
        if not model_dirs:
            raise RuntimeError("no SavedModel directories found")
        self._energies = energies
        self.names = [os.path.basename(path.rstrip("/")) for path in model_dirs]
        self._models = [load_model(path) for path in model_dirs]

    def predict(self, contexts: List[str]) -> List[dict]:
        """Per guide: the ensemble mean, each model's own prediction, and the CRISPRoff energy terms."""
        import numpy as np  # pyright: ignore[reportMissingImports]  (TensorFlow container only)

        terms = self._energies(contexts)
        onehot = np.asarray(one_hot(contexts), dtype=np.float32)  # [batch, 30, 4]
        dg = np.asarray([t["crisproff_score"] for t in terms], dtype=np.float32).reshape(-1, 1)  # [batch, 1]
        inputs = {"input_onehot": onehot, "input_dGB": dg}
        per_model = np.stack([np.asarray(m(inputs)).reshape(-1) for m in self._models])  # [models, batch]
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
