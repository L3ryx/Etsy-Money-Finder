import requests
import sys
import json
import os

ZENROWS_API = os.getenv("ZENROWS_API")
IMGBB_API = os.getenv("IMGBB_API")

keyword = sys.argv[1]
limit = int(sys.argv[2])

results = []

# -------- SCRAPE ETSY --------

etsy_url = f"https://www.etsy.com/search?q={keyword}"

params = {
"url": etsy_url,
"apikey": ZENROWS_API,
"js_render":"true"
}

html = requests.get("https://api.zenrows.com/v1/",params=params).text

# simulation extraction
for i in range(limit):

    image = "https://dummyimage.com/400x400"

    # -------- UPLOAD IMGBB --------

    upload = requests.post(
        "https://api.imgbb.com/1/upload",
        data={
            "key":IMGBB_API,
            "image":image
        }
    )

    img_url = image

    # -------- SEARCH ALIEXPRESS --------

    ali = f"https://www.aliexpress.com/wholesale?SearchText={keyword}"

    results.append({

        "etsy":{
            "title":f"Etsy product {i}",
            "image":image,
            "link":"https://etsy.com"
        },

        "aliexpress":[
            {
                "title":"Ali product 1",
                "price":"$2",
                "link":ali
            },
            {
                "title":"Ali product 2",
                "price":"$3",
                "link":ali
            }
        ]

    })

print(json.dumps(results))
