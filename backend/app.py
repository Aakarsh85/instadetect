"""
app.py — Fake Account Detection API
Flask backend that loads a trained sklearn model and exposes
a /predict endpoint for inference.

Usage:
    python app.py                 # development
    gunicorn app:app -w 4         # production
"""

import os
import pickle
import logging
from dataclasses import dataclass
from typing import Any

import numpy as np
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── App ───────────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})  # restrict origins in prod

# ── Config ────────────────────────────────────────────────────────────────────
MODEL_PATH: str  = os.getenv("MODEL_PATH", os.path.join(os.path.dirname(__file__), "model.pkl"))
DEBUG_MODE: bool = os.getenv("FLASK_ENV", "development") == "development"

# ── Load model at startup ─────────────────────────────────────────────────────
model: Any = None

try:
    with open(MODEL_PATH, "rb") as f:
        model = pickle.load(f)
    logger.info("Model loaded successfully from %s", MODEL_PATH)
except FileNotFoundError:
    logger.warning("model.pkl not found at %s — /predict will return 503", MODEL_PATH)
except Exception as exc:
    logger.error("Failed to load model: %s", exc)


# ── Input schema ──────────────────────────────────────────────────────────────
@dataclass
class ProfileInput:
    username:  str
    bio:       str
    followers: int
    following: int
    posts:     int

    def validate(self) -> list[str]:
        """Return a list of validation error messages (empty = valid)."""
        errors: list[str] = []

        if not self.username or not self.username.strip():
            errors.append("'username' must be a non-empty string.")

        for field, value in [
            ("followers", self.followers),
            ("following", self.following),
            ("posts",     self.posts),
        ]:
            if not isinstance(value, int) or value < 0:
                errors.append(f"'{field}' must be a non-negative integer.")

        return errors

    def to_feature_vector(self) -> np.ndarray:
        """
        Convert input into the feature array the model was trained on.
        Edit column order to match your training pipeline exactly.
        """
        bio_clean      = (self.bio or "").strip()
        username_clean = (self.username or "").strip()

        has_bio         = 1 if bio_clean else 0
        bio_length      = len(bio_clean)
        username_length = len(username_clean)
        follower_ratio  = self.followers / (self.following + 1)  # +1 avoids div-by-zero

        return np.array([[
            self.followers,      # raw follower count
            self.following,      # raw following count
            self.posts,          # number of posts
            has_bio,             # 1 if bio exists, else 0
            bio_length,          # character length of bio
            username_length,     # character length of username
            follower_ratio,      # followers / (following + 1)
        ]], dtype=np.float64)


# ── Helpers ───────────────────────────────────────────────────────────────────
def parse_input(body: dict) -> tuple:
    """Parse + validate the request dict into a ProfileInput."""
    required = ("username", "followers", "following", "posts")
    missing  = [f for f in required if f not in body]
    if missing:
        return None, [f"Missing required field(s): {', '.join(missing)}."]

    try:
        profile = ProfileInput(
            username  = str(body.get("username", "")),
            bio       = str(body.get("bio", "")),
            followers = int(body["followers"]),
            following = int(body["following"]),
            posts     = int(body["posts"]),
        )
    except (ValueError, TypeError) as exc:
        return None, [f"Type error in input: {exc}"]

    errors = profile.validate()
    return (profile, []) if not errors else (None, errors)


def error_response(message, status: int):
    """Return a consistent JSON error envelope."""
    msg = message if isinstance(message, str) else "; ".join(message)
    logger.warning("HTTP %d — %s", status, msg)
    return jsonify({"error": msg}), status


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route("/api/health", methods=["GET"])
def health():
    """Health check endpoint for uptime monitors and load-balancers."""
    return jsonify({
        "status":       "ok",
        "model_loaded": model is not None,
    }), 200


@app.route("/api/predict", methods=["POST"])
def predict():
    """
    Predict whether a social media account is fake or real.

    Request body (JSON):
        {
            "username":  "john_doe",
            "bio":       "Digital creator",
            "followers": 120,
            "following": 4800,
            "posts":     3
        }

    Success response (200):
        {
            "prediction": "Fake",
            "confidence": 0.91,
            "is_fake":    true
        }

    Error responses:
        400 — invalid / non-JSON body
        422 — failed input validation
        500 — inference error
        503 — model not loaded
    """
    # 503: model unavailable
    if model is None:
        return error_response(
            "Model not loaded. Place model.pkl in the backend folder and restart.",
            503,
        )

    # 400: bad JSON
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return error_response("Request body must be valid JSON.", 400)

    # 422: validation failed
    profile, errors = parse_input(body)
    if errors:
        return error_response(errors, 422)

    # Inference
    try:
        features      = profile.to_feature_vector()
        raw_pred      = model.predict(features)[0]           # 0 = Real, 1 = Fake
        probabilities = model.predict_proba(features)[0]     # [P(real), P(fake)]

        is_fake    = bool(int(raw_pred) == 1)
        label      = "Fake" if is_fake else "Real"
        confidence = round(float(max(probabilities)), 4)     # e.g. 0.9132

        logger.info(
            "Prediction for @%s → %s (confidence=%.2f%%)",
            profile.username, label, confidence * 100,
        )

        return jsonify({
            "prediction": label,
            "confidence": confidence,
            "is_fake":    is_fake,
        }), 200

    except Exception as exc:
        logger.exception("Inference error: %s", exc)
        return error_response("Inference failed. Check server logs for details.", 500)


# ── Error handlers ────────────────────────────────────────────────────────────
@app.errorhandler(404)
def not_found(_err):
    return jsonify({"error": "Endpoint not found."}), 404


@app.errorhandler(405)
def method_not_allowed(_err):
    return jsonify({"error": "Method not allowed."}), 405


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 5000)),
        debug=DEBUG_MODE,
    )
