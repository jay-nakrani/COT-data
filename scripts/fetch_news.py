"""
Fetch financial news from multiple RSS feeds and economic calendar
from ForexFactory (Faireconomy Media). Saves to data/news.json and
data/calendar.json.

Usage:
    python3 scripts/fetch_news.py

No external libraries required - just the Python standard library.
"""

import json
import os
import urllib.request
import xml.etree.ElementTree as ET
import datetime as dt
import re
import hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEWS_JSON = os.path.join(ROOT, "data", "news.json")
CALENDAR_JSON = os.path.join(ROOT, "data", "calendar.json")

FEEDS = [
    {"name": "FinancialJuice", "url": "https://features.financialjuice.com/feed/", "category": "forex"},
    {"name": "ForexLive", "url": "https://www.forexlive.com/feed/", "category": "forex"},
    {"name": "FXStreet", "url": "https://www.fxstreet.com/rss", "category": "forex"},
    {"name": "CNBC", "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html", "category": "general"},
    {"name": "Yahoo Finance", "url": "https://finance.yahoo.com/rss/", "category": "general"},
    {"name": "MarketWatch", "url": "https://www.marketwatch.com/rss/topstories", "category": "general"},
]

FF_CAL_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

ASSET_KEYWORDS = {
    "GC":    ["gold", "xau", "bullion", "precious metal", "xauusd", "gold futures"],
    "SI":    ["silver", "xag", "silver futures"],
    "ES":    ["s&p", "s&p 500", "sp500", "e-mini s&p", "us stock", "wall street", "dow", "us equities", "us stocks"],
    "NQ":    ["nasdaq", "ndx", "tech stock", "semiconductor", "chip", "ai trade", "nasdaq 100", "tech stocks"],
    "YM":    ["dow jones", "djia", "industrial average"],
    "NIY":   ["nikkei", "japanese stock", "tokyo stock"],
    "6S":    ["swiss franc", "chf", "swissie"],
    "6C":    ["canadian dollar", "cad", "loonie", "boc", "bank of canada"],
    "6A":    ["australian dollar", "aud", "aussie", "rba", "reserve bank of australia"],
    "6E":    ["euro", "eur", "ecb", "european central bank", "eurozone", "bundesbank", "eurusd", "euro zone"],
    "6N":    ["nz dollar", "nzd", "kiwi", "rbnz", "reserve bank of new zealand", "nzdusd"],
    "6J":    ["japanese yen", "jpy", "yen", "boj", "bank of japan", "tokyo", "usdjpy", "yen "],
    "6B":    ["british pound", "gbp", "sterling", "cable", "boe", "bank of england", "gbpusd"],
    "USD":   ["dollar", "usd", "dxy", "dollar index", "fed", "fomc", "federal reserve", "powell", "treasury", "yields", "rates", "dollar ", "us dollar"],
    "OIL":   ["oil", "crude", "brent", "wti", "opec", "energy", "barrel", "gasoline", "petroleum"],
    "BONDS": ["bonds", "treasury", "yields", "10-year", "2-year", "yield curve", "t-note", "t-bond", "treasuries"],
}

ASSET_NAMES = {
    "GC": "Gold", "SI": "Silver", "ES": "S&P 500", "NQ": "Nasdaq 100",
    "YM": "Dow Jones", "NIY": "Nikkei 225", "6S": "Swiss Franc",
    "6C": "Canadian Dollar", "6A": "Australian Dollar", "6E": "Euro",
    "6N": "NZ Dollar", "6J": "Japanese Yen", "6B": "British Pound",
    "USD": "US Dollar", "OIL": "Crude Oil", "BONDS": "US Treasuries",
}

BULLISH_KEYWORDS = [
    "rise", "rises", "rising", "rose", "rally", "rallies", "surge", "surges",
    "gain", "gains", "gained", "jump", "jumps", "jumped", "soar", "soars",
    "climb", "climbs", "climbed", "advance", "advances", "advanced",
    "boost", "boosts", "boosted", "rebound", "rebounds", "rebounded",
    "recover", "recovers", "recovered", "bounce", "bounces", "bounced",
    "bullish", "optimism", "optimistic", "strong", "strength",
    "up", "higher", "record high", "all-time high", "breakout",
    "beat", "beats", "beaten", "exceed", "exceeds", "surpass", "surpasses",
    "upgrade", "upgrades", "buy", "overweight",
    "cut rates", "rate cut", "rate cuts", "dovish", "easing",
    "support", "supportive", "positive", "growth", "expand", "expansion",
    "jobs growth", "employment gain", "wage growth",
    "safe haven", "safe-haven", "risk-off", "risk off", "flight to safety",
    "geopolitical tension", "uncertainty", "tariff", "tariffs",
]

BEARISH_KEYWORDS = [
    "fall", "falls", "falling", "fell", "drop", "drops", "dropped",
    "decline", "declines", "declined", "slide", "slides", "slid",
    "sink", "sinks", "sank", "plunge", "plunges", "plunged",
    "tumble", "tumbles", "tumbled", "slump", "slumps", "slumped",
    "retreat", "retreats", "retreated", "pull back", "pulled back",
    "bearish", "pessimism", "pessimistic", "weak", "weakness",
    "down", "lower", "record low", "sell-off", "selloff", "sell off",
    "miss", "misses", "missed", "disappoint", "disappoints", "disappointed",
    "downgrade", "downgrades", "sell", "underweight",
    "hike rates", "rate hike", "rate hikes", "hawkish", "tightening",
    "concern", "concerns", "worried", "worry", "fear", "fears",
    "risk", "risky", "correction", "crash", "bubble",
    "recession", "contraction", "shrink", "shrinking",
    "jobs slowdown", "job losses", "unemployment rise", "layoff", "layoffs",
    "inflation", "inflationary", "stagflation",
    "sanction", "sanctions", "embargo", "conflict", "war",
    "default", "bankruptcy", "insolvency",
    "oil drops", "oil falls", "crude falls",
]

NEGATION_WORDS = ["not", "no", "never", "neither", "nor", "without", "hardly", "barely", "don't", "doesn't", "didn't", "won't", "isn't", "aren't", "wasn't", "weren't", "haven't", "hasn't", "hadn't"]


def html_to_text(html):
    text = re.sub(r'<a[^>]*>(.*?)</a>', r'\1', html)
    text = re.sub(r'<[^>]+>', '', text)
    text = text.replace('&#039;', "'").replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&nbsp;', ' ').replace('&quot;', '"').replace('&#39;', "'").replace('&#x27;', "'")
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def generate_id(title, pub_date, source):
    raw = f"{title}_{pub_date}_{source}"
    return hashlib.md5(raw.encode()).hexdigest()[:12]


def parse_date(date_str):
    if not date_str:
        return dt.datetime.now(dt.timezone.utc).isoformat()
    fixed = date_str.strip().replace("GMT", "+0000").replace("UTC", "+0000")
    for fmt in ["%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S"]:
        try:
            dt_obj = dt.datetime.strptime(fixed, fmt)
            if dt_obj.tzinfo is None:
                dt_obj = dt_obj.replace(tzinfo=dt.timezone.utc)
            return dt_obj.isoformat()
        except:
            pass
    try:
        return dt.datetime.fromisoformat(date_str.replace("Z", "+00:00")).isoformat()
    except:
        return date_str


def detect_assets(text):
    text_lower = text.lower()
    found = []
    for symbol, keywords in ASSET_KEYWORDS.items():
        for kw in keywords:
            if re.search(r'\b' + re.escape(kw) + r'\b', text_lower):
                found.append(symbol)
                break
    return found


def analyze_sentiment(text):
    text_lower = text.lower()
    bullish_count = 0
    bearish_count = 0
    bullish_hits = []
    bearish_hits = []

    for kw in BULLISH_KEYWORDS:
        matches = list(re.finditer(r'\b' + re.escape(kw) + r'\b', text_lower))
        for m in matches:
            sent_start = max(0, text_lower.rfind('.', 0, m.start()))
            sent_end = text_lower.find('.', m.end())
            if sent_end == -1: sent_end = len(text_lower)
            sentence = text_lower[sent_start:sent_end]
            negated = any(neg in sentence for neg in NEGATION_WORDS)
            if negated:
                bearish_count += 1
                bearish_hits.append(f"not {kw}")
            else:
                bullish_count += 1
                bullish_hits.append(kw)

    for kw in BEARISH_KEYWORDS:
        matches = list(re.finditer(r'\b' + re.escape(kw) + r'\b', text_lower))
        for m in matches:
            sent_start = max(0, text_lower.rfind('.', 0, m.start()))
            sent_end = text_lower.find('.', m.end())
            if sent_end == -1: sent_end = len(text_lower)
            sentence = text_lower[sent_start:sent_end]
            negated = any(neg in sentence for neg in NEGATION_WORDS)
            if negated:
                bullish_count += 1
                bullish_hits.append(f"not {kw}")
            else:
                bearish_count += 1
                bearish_hits.append(kw)

    total = bullish_count + bearish_count
    if total == 0:
        return {"direction": "neutral", "score": 0, "confidence": 0, "bullish_hits": [], "bearish_hits": []}

    score = (bullish_count - bearish_count) / total
    confidence = min(95, 40 + total * 12)
    if score > 0.15:
        direction = "bullish"
    elif score < -0.15:
        direction = "bearish"
    else:
        direction = "neutral"
        confidence = min(confidence, 50)

    return {"direction": direction, "score": round(score, 2), "confidence": confidence, "bullish_hits": bullish_hits, "bearish_hits": bearish_hits}


def generate_explanation(symbol, asset_name, sentiment, title):
    direction = sentiment["direction"]
    confidence = sentiment["confidence"]

    if direction == "bullish":
        if symbol in ("GC", "SI"):
            return f"Bullish for {asset_name} ({confidence}%) - safe-haven demand or dollar weakness typically lifts precious metals."
        elif symbol in ("ES", "NQ", "YM", "NIY"):
            return f"Bullish for {asset_name} ({confidence}%) - risk-on sentiment or positive data supports equity indices."
        elif symbol == "OIL":
            return f"Bullish for {asset_name} ({confidence}%) - supply concerns or demand growth lifts crude prices."
        elif symbol == "USD":
            return f"Bullish for {asset_name} ({confidence}%) - hawkish Fed or strong US data supports the dollar."
        elif symbol == "BONDS":
            return f"Bullish for {asset_name} ({confidence}%) - rate cut expectations or safe-haven flows lift bonds."
        elif symbol in ("6E", "6B", "6J", "6A", "6C", "6S", "6N"):
            return f"Bullish for {asset_name} ({confidence}%) - relative strength in this currency vs peers."
        else:
            return f"Bullish for {asset_name} ({confidence}%)."
    elif direction == "bearish":
        if symbol in ("GC", "SI"):
            return f"Bearish for {asset_name} ({confidence}%) - risk-on or dollar strength pressures precious metals."
        elif symbol in ("ES", "NQ", "YM", "NIY"):
            return f"Bearish for {asset_name} ({confidence}%) - risk-off or economic concerns weigh on equities."
        elif symbol == "OIL":
            return f"Bearish for {asset_name} ({confidence}%) - demand concerns or supply glut pressures crude."
        elif symbol == "USD":
            return f"Bearish for {asset_name} ({confidence}%) - dovish Fed or weak US data weakens the dollar."
        elif symbol == "BONDS":
            return f"Bearish for {asset_name} ({confidence}%) - rate hike expectations or inflation fears hit bonds."
        elif symbol in ("6E", "6B", "6J", "6A", "6C", "6S", "6N"):
            return f"Bearish for {asset_name} ({confidence}%) - relative weakness in this currency vs peers."
        else:
            return f"Bearish for {asset_name} ({confidence}%)."
    else:
        return f"Neutral impact on {asset_name} - no clear directional bias."


def analyze_news_item(title, description):
    full_text = f"{title}. {description}"
    assets_detected = detect_assets(full_text)
    overall_sentiment = analyze_sentiment(full_text)

    asset_analysis = []
    for symbol in assets_detected:
        sentences = re.split(r'[.!?]+', full_text)
        asset_context = []
        keywords = ASSET_KEYWORDS.get(symbol, [])
        for sent in sentences:
            sent_lower = sent.lower()
            if any(re.search(r'\b' + re.escape(kw) + r'\b', sent_lower) for kw in keywords):
                asset_context.append(sent.strip())

        if asset_context:
            asset_text = ". ".join(asset_context)
            sent = analyze_sentiment(asset_text)
        else:
            sent = overall_sentiment

        asset_name = ASSET_NAMES.get(symbol, symbol)
        explanation = generate_explanation(symbol, asset_name, sent, title)

        asset_analysis.append({
            "symbol": symbol,
            "name": asset_name,
            "direction": sent["direction"],
            "confidence": sent["confidence"],
            "explanation": explanation,
        })

    if overall_sentiment["direction"] == "bullish":
        summary = f"Bullish ({overall_sentiment['confidence']}%)"
        if overall_sentiment.get("bullish_hits"):
            summary += f" - {', '.join(overall_sentiment['bullish_hits'][:5])}"
    elif overall_sentiment["direction"] == "bearish":
        summary = f"Bearish ({overall_sentiment['confidence']}%)"
        if overall_sentiment.get("bearish_hits"):
            summary += f" - {', '.join(overall_sentiment['bearish_hits'][:5])}"
    else:
        summary = "Neutral / mixed signals"

    return {
        "assets": asset_analysis,
        "overall": overall_sentiment["direction"],
        "score": overall_sentiment["score"],
        "confidence": overall_sentiment["confidence"],
        "summary": summary,
    }


# Helper: find an element, trying multiple tag names (handles the ElementTree
# gotcha where elements with no children are falsy so `a or b` skips a valid a)
def find_elem(item, *tag_names):
    for tag in tag_names:
        elem = item.find(tag)
        if elem is not None:
            return elem
    return None


def fetch_rss_feed(feed):
    url = feed["url"]
    source_name = feed["name"]
    source_category = feed.get("category", "general")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "COT-Desk-Bot/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read().decode("utf-8", errors="ignore")

        root = ET.fromstring(content)
        items = root.findall(".//item")
        if not items:
            items = root.findall(".//{http://www.w3.org/2005/Atom}entry")

        news_items = []
        for item in items:
            title_elem = find_elem(item, "title", "{http://www.w3.org/2005/Atom}title")
            pub_elem = find_elem(item, "pubDate", "{http://www.w3.org/2005/Atom}published", "{http://www.w3.org/2005/Atom}updated")
            link_elem = find_elem(item, "link", "{http://www.w3.org/2005/Atom}link")
            desc_elem = find_elem(item, "description", "{http://www.w3.org/2005/Atom}summary")
            cats = item.findall("category")
            if not cats:
                cats = item.findall("{http://www.w3.org/2005/Atom}category")

            title = html_to_text(title_elem.text if title_elem is not None and title_elem.text else "")
            if not title:
                continue

            pub_date_raw = pub_elem.text if pub_elem is not None else ""
            pub_date = parse_date(pub_date_raw)

            if link_elem is not None:
                link = link_elem.text or link_elem.get("href", "") or ""
            else:
                link = ""

            desc_html = desc_elem.text if desc_elem is not None and desc_elem.text else ""
            desc = html_to_text(desc_html)
            categories = [c.text if c.text else c.get("term", "") for c in cats if c.text or c.get("term")]

            analysis = analyze_news_item(title, desc if desc else title)
            news_id = generate_id(title, pub_date_raw, source_name)

            news_items.append({
                "id": news_id,
                "title": title,
                "pubDate": pub_date,
                "pubDateDisplay": pub_date_raw,
                "source": source_name,
                "category": source_category,
                "categories": categories,
                "link": link,
                "description": desc[:500],
                "analysis": analysis,
            })

        return news_items

    except Exception as e:
        print(f"  ERROR fetching {source_name}: {e}")
        return []


def fetch_forexfactory_calendar():
    req = urllib.request.Request(FF_CAL_URL, headers={"User-Agent": "COT-Desk-Bot/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    data.sort(key=lambda e: e.get("date", ""))
    return data


def main():
    os.makedirs(os.path.dirname(NEWS_JSON), exist_ok=True)

    print("Fetching news from multiple RSS feeds...")
    all_news = []

    for feed in FEEDS:
        print(f"  Fetching {feed['name']}...")
        items = fetch_rss_feed(feed)
        print(f"    Got {len(items)} items")
        all_news.extend(items)

    print(f"  Total: {len(all_news)} news items from all feeds")

    # Deduplicate
    seen_ids = set()
    unique_news = []
    for item in all_news:
        if item["id"] not in seen_ids:
            seen_ids.add(item["id"])
            unique_news.append(item)

    unique_news.sort(key=lambda n: n.get("pubDate", ""), reverse=True)

    # Keep up to 25 from each source for diversity, then fill remaining
    per_source = {}
    balanced = []
    remaining = []
    for item in unique_news:
        src = item.get("source", "unknown")
        per_source[src] = per_source.get(src, 0) + 1
        if per_source[src] <= 25:
            balanced.append(item)
        else:
            remaining.append(item)

    balanced.sort(key=lambda n: n.get("pubDate", ""), reverse=True)
    final_news = (balanced + remaining)[:150]

    # Merge with existing
    existing_news = []
    if os.path.exists(NEWS_JSON):
        with open(NEWS_JSON) as f:
            try:
                existing_data = json.load(f)
                existing_news = existing_data.get("news", [])
            except:
                pass

    new_ids = {n["id"] for n in final_news}
    old_news = [n for n in existing_news if n["id"] not in new_ids]
    merged = final_news + old_news[:30]
    merged.sort(key=lambda n: n.get("pubDate", ""), reverse=True)
    merged = merged[:150]

    news_data = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
        "news": merged,
    }

    with open(NEWS_JSON, "w") as f:
        json.dump(news_data, f, indent=1)
    print(f"  Saved {len(news_data['news'])} items to {NEWS_JSON}")

    print("\nFetching ForexFactory calendar...")
    try:
        events = fetch_forexfactory_calendar()
        print(f"  Got {len(events)} calendar events")
        cal_data = {"generated": dt.datetime.now(dt.timezone.utc).isoformat(), "events": events}
        with open(CALENDAR_JSON, "w") as f:
            json.dump(cal_data, f, indent=1)
        print(f"  Saved to {CALENDAR_JSON}")
    except Exception as e:
        print(f"  ERROR fetching calendar: {e}")
        if not os.path.exists(CALENDAR_JSON):
            with open(CALENDAR_JSON, "w") as f:
                json.dump({"generated": dt.datetime.now(dt.timezone.utc).isoformat(), "events": []}, f)

    print(f"\nDone! Total news items: {len(news_data['news'])}")


if __name__ == "__main__":
    main()
