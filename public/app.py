import os
import re
import requests
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/search", methods=["POST"])
def search():
    data = request.json
    keyword = data.get("keyword")
    limit = int(data.get("limit", 10))

    if not keyword:
        return jsonify({"error": "Keyword required"}), 400

    url = f"https://www.etsy.com/search?q={keyword}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    }

    try:
        response = requests.get(url, headers=headers, timeout=20)
        html = response.text

        # Extraction image + link
        images = re.findall(r'https://i\.etsystatic\.com[^"\']+', html)
        links = re.findall(r'https://www\.etsy\.com/listing/\d+', html)

        results = []
        for i in range(min(limit, len(images))):
            results.append({
                "image": images[i],
                "link": links[i] if i < len(links) else url
            })

        if not results:
            return jsonify({"results": [], "warning": "Aucun résultat trouvé ou bloqué par Etsy"}), 200

        return jsonify({"results": results})

    except requests.exceptions.RequestException as e:
        return jsonify({"error": "Impossible de joindre Etsy", "details": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
