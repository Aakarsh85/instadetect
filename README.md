# ⬡ ShieldScan — Fake Account Detector

An AI-powered web app that detects fake social media accounts using a trained ML model.

🔗 **Live Demo:** _Add your Vercel URL here_  
🔗 **API:** _Add your Render URL here_

---

## 📁 Folder Structure

```
fake-account-detector/
├── backend/
│   ├── app.py              ← Flask REST API
│   ├── model.pkl           ← Trained ML model (add yours here)
│   ├── render.yaml         ← Render deployment config
│   └── requirements.txt    ← Python dependencies
├── frontend/
│   ├── index.html          ← Full UI (dark mode, gauge, history drawer)
│   └── app.js              ← API calls, validation, UI logic
├── .gitignore
└── README.md
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 + Flask |
| ML | scikit-learn (.pkl model) |
| Frontend | Vanilla HTML / CSS / JS |
| Deployment | Render (API) + Vercel (frontend) |

---

## 🚀 Local Setup

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
# Place your trained model:
cp /path/to/your/model.pkl ./model.pkl
python app.py
# → Running on http://127.0.0.1:5000
```

### Frontend
```bash
cd frontend
python -m http.server 8080
# → Open http://localhost:8080
```

---

## 🔌 API

### `GET /api/health`
```json
{ "status": "ok", "model_loaded": true }
```

### `POST /api/predict`
```json
// Request
{
  "username": "john_doe",
  "bio": "Digital creator",
  "followers": 120,
  "following": 4800,
  "posts": 3
}

// Response
{
  "prediction": "Fake",
  "confidence": 0.91,
  "is_fake": true
}
```

---

## 🌐 Deployment

**Backend → Render**
1. Push repo to GitHub
2. New Web Service → connect repo → set Root Directory to `backend`
3. Build: `pip install -r requirements.txt`
4. Start: `gunicorn app:app --workers 2 --timeout 120`

**Frontend → Vercel**
1. Import repo → set Root Directory to `frontend`
2. Framework: Other → Deploy

Update `CONFIG.API_BASE` in `app.js` with your Render URL before deploying frontend.

---

## ✨ Features

- Dark / light mode with persistence
- SVG animated confidence gauge
- Skeleton loader while predicting
- Prediction history drawer (session)
- Contextual button copy states
- Glassmorphism card UI
- Fully responsive

---

## 📜 License
MIT
