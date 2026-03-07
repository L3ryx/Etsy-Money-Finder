from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import os

# =====================================================
# APP SETUP
# =====================================================

app = Flask(__name__,
            template_folder="templates",
            static_folder="static")

CORS(app)

PORT = int(os.environ.get("PORT", 5000))


# =====================================================
# HOME ROUTE (ÉVITE "Cannot GET /")
# =====================================================

@app.route("/")
def home():
    return render_template("index.html")


# =====================================================
# EXEMPLE API SEARCH
# =====================================================

@app.route("/search", methods=["POST"])
def search():

    data = request.json

    keyword = data.get("keyword")
    limit = data.get("limit", 10)

    if not keyword:
        return jsonify({"error": "Keyword required"}), 400

    # 🔥 Exemple réponse test
    results = []

    for i in range(limit):
        results.append({
            "title": f"{keyword} result {i+1}",
            "image": "https://via.placeholder.com/300",
            "link": "https://example.com"
        })

    return jsonify({
        "success": True,
        "results": results
    })


# =====================================================
# HEALTH CHECK (BON POUR RENDER)
# =====================================================

@app.route("/health")
def health():
    return jsonify({"status": "ok"})


# =====================================================
# START SERVER
# =====================================================

if __name__ == "__main__":
    print("🚀 Server running on port", PORT)
    app.run(host="0.0.0.0", port=PORT, debug=False)
