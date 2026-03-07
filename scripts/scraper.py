import requests
import os
import sys
import json

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

keyword = sys.argv[1]
limit = int(sys.argv[2])

results = []

# simulation Etsy scrape
etsy_products = []

for i in range(limit):

    etsy_products.append({
        "title": f"Etsy product {i}",
        "image": "https://dummyimage.com/400x400",
        "link": f"https://etsy.com/listing/{i}"
    })


# simulation AliExpress scrape
ali_products = []

for i in range(5):

    ali_products.append({
        "title": f"Ali product {i}",
        "image": "https://dummyimage.com/400x400",
        "link": f"https://aliexpress.com/item/{i}"
    })


def compare_images(img1,img2):

    url="https://api.openai.com/v1/chat/completions"

    headers={
        "Authorization":f"Bearer {OPENAI_API_KEY}",
        "Content-Type":"application/json"
    }

    payload={
        "model":"gpt-4o",
        "messages":[
        {
            "role":"user",
            "content":[
                {"type":"text","text":"Give similarity percentage between these two product images. Only return a number from 0 to 100."},
                {"type":"image_url","image_url":{"url":img1}},
                {"type":"image_url","image_url":{"url":img2}}
            ]
        }]
    }

    r=requests.post(url,headers=headers,json=payload)

    try:
        text=r.json()["choices"][0]["message"]["content"]
        score=int(''.join(filter(str.isdigit,text)))
    except:
        score=0

    return score


for etsy in etsy_products:

    best=None
    best_score=0

    for ali in ali_products:

        score=compare_images(etsy["image"],ali["image"])

        if score>best_score:

            best_score=score
            best=ali

    if best_score>=70:

        results.append({

            "etsy_title":etsy["title"],
            "etsy_image":etsy["image"],
            "etsy_link":etsy["link"],

            "ali_title":best["title"],
            "ali_image":best["image"],
            "ali_link":best["link"],

            "similarity":best_score

        })


print(json.dumps(results))
