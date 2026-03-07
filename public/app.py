import os
import re
import requests
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)


# =====================================================
# SEARCH ETSY
# =====================================================

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

    etsy_url = f"https://www.etsy.com/search?q={keyword}"

    headers = {
        "User-Agent": "Mozilla/5.0"
    }

    try:
        response = requests.get(etsy_url, headers=headers, timeout=20)
        html = response.text

        # Extraction image + link
        image_regex = r"https:\/\/i\.etsystatic\.com[^\"']+"
        link_regex = r"https:\/\/www\.etsy\.com\/listing\/\d+"

        images = re.findall(image_regex, html)
        links = re.findall(link_regex, html)

        results = []

        for i in range(min(limit, len(images))):
            results.append({
                "image": images[i],
                "link": links[i] if i < len(links) else etsy_url
            })

        return jsonify({"results": results})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =====================================================
# START SERVER
# =====================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
