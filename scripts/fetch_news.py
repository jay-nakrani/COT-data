"""
Fetch financial news from FinancialJuice RSS feed and economic calendar
from ForexFactory (Faireconomy Media). Saves to data/news.json and
data/calendar.json.

Run this script to populate news and calendar data. In the repo this
also runs automatically via .github/workflows/fetch_news.yml every 2 hours.

Usage:
    python3 scripts/fetch_news.py

No external libraries required - just the Python standard library.
"""

import json
import os
import sys
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import datetime as dt
import re
import hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEWS_JSON = os.path.join(ROOT, "data", "news.json")
CALENDAR_JSON = os.path.join(ROOT, "data", "calendar.json")

FJ_RSS_URL = "https://features.financialjuice.com/feed/"
FF_CAL_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

# ---------------------------------------------------------------------------
# Asset keyword detection - used to tag news with relevant assets
# ---------------------------------------------------------------------------
ASSET_KEYWORDS = {
    "GC":    ["gold", "xau", "bullion", "precious metal"],
    "SI":    ["silver", "xag"],
    "ES":    ["s&p", "s&p 500", "sp500", "e-mini s&p", "us stock", "wall street", "dow"],
    "NQ":    ["nasdaq", "ndx", "tech stock", "semiconductor", "chip", "ai trade"],
    "YM":    ["dow jones", "djia", "industrial average"],
    "NIY":   ["nikkei", "japanese stock", "tokyo stock"],
    "6S":    ["swiss franc", "chf", "swissie"],
    "6C":    ["canadian dollar", "cad", "loonie", "boc", "bank of canada"],
    "6A":    ["australian dollar", "aud", "aussie", "rba", "reserve bank of australia"],
    "6E":    ["euro", "eur", "ecb", "european central bank", "eurozone", "bundesbank"],
    "6N":    ["nz dollar", "nzd", "kiwi", "rbnz", "reserve bank of new zealand"],
    "6J":    ["japanese yen", "jpy", "yen", "boj", "bank of japan", "tokyo"],
    "6B":    ["british pound", "gbp", "sterling", "cable", "boe", "bank of england"],
    "USD":   ["dollar", "usd", "dxy", "dollar index", "fed", "fomc", "federal reserve", "powell", "treasury", "yields", "rates"],
    "OIL":   ["oil", "crude", "brent", "wti", "opec", "energy"],
    "BONDS": ["bonds", "treasury", "yields", "10-year", "2-year", "yield curve", "t-note", "t-bond"],
}

# ---------------------------------------------------------------------------
# Financial sentiment keyword dictionaries
# ---------------------------------------------------------------------------
BULLISH_KEYWORDS = [
    "rise", "rises", "rising", "rose", "rally", "rallies", "surge", "surges",
    "gain", "gains", "gained", "jump", "jumps", "jumped", "soar", "soars",
    "climb", "climbs", "climbed", "advance", "advances", "advanced",
    "boost", "boosts", "boosted", "rebound", "rebounds", "rebounded",
    "recover", "recovers", "recovered", "bounce", "bounces", "bounced",
    "rally", "bullish", "optimism", "optimistic", "strong", "strength",
    "up", "higher", "record high", "all-time high", "breakout",
    "beat", "beats", "beaten", "exceed", "exceeds", "surpass", "surpasses",
    "upgrade", "upgrades", "upgrade", "buy", "overweight",
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


def html_to_text(html):
    """Strip HTML tags and return plain text."""
    # Remove links but keep text
    text = re.sub(r'<a[^>]*>(.*?)</a>', r'\1', html)
    # Remove all other tags
    text = re.sub(r'<[^>]+>', '', text)
    # Clean up entities
    text = text.replace('&#039;', "'").replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&nbsp;', ' ').replace('&quot;', '"')
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def generate_id(title, pub_date):
    """Generate a stable ID from title and date."""
    raw = f"{title}_{pub_date}"
    return hashlib.md5(raw.encode()).hexdigest()[:12]


def detect_assets(text):
    """Detect which assets are mentioned in the text."""
    text_lower = text.lower()
    found = []
    for symbol, keywords in ASSET_KEYWORDS.items():
        for kw in keywords:
            if re.search(r'\b' + re.escape(kw) + r'\b', text_lower):
                found.append(symbol)
                break
    return found


def analyze_sentiment(text):
    """
    Analyze sentiment of a news headline + description.
    Returns: { direction: 'bullish'|'bearish'|'neutral', score: float, confidence: int }
    Score ranges from -1 (very bearish) to +1 (very bullish).
    Confidence is 0-100.
    """
    text_lower = text.lower()
    
    bullish_count = 0
    bearish_count = 0
    bullish_hits = []
    bearish_hits = []
    
    for kw in BULLISH_KEYWORDS:
        if re.search(r'\b' + re.escape(kw) + r'\b', text_lower):
            bullish_count += 1
            bullish_hits.append(kw)
    
    for kw in BEARISH_KEYWORDS:
        if re.search(r'\b' + re.escape(kw) + r'\b', text_lower):
            bearish_count += 1
            bearish_hits.append(kw)
    
    total = bullish_count + bearish_count
    
    if total == 0:
        return {
            "direction": "neutral",
            "score": 0,
            "confidence": 0,
            "bullish_hits": [],
            "bearish_hits": [],
        }
    
    score = (bullish_count - bearish_count) / total
    
    # Confidence based on number of signals
    confidence = min(95, 40 + total * 15)
    
    if score > 0.15:
        direction = "bullish"
    elif score < -0.15:
        direction = "bearish"
    else:
        direction = "neutral"
        confidence = min(confidence, 50)
    
    return {
        "direction": direction,
        "score": round(score, 2),
        "confidence": confidence,
        "bullish_hits": bullish_hits,
        "bearish_hits": bearish_hits,
    }


def analyze_news_item(title, description):
    """Full analysis of a news item: detect assets and sentiment per asset."""
    full_text = f"{title}. {description}"
    
    assets_detected = detect_assets(full_text)
    overall_sentiment = analyze_sentiment(full_text)
    
    # Per-asset sentiment analysis
    asset_analysis = []
    for symbol in assets_detected:
        # Analyze sentiment in the context of each asset
        # Find sentences mentioning this asset
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
        
        asset_analysis.append({
            "symbol": symbol,
            "direction": sent["direction"],
            "confidence": sent["confidence"],
        })
    
    # Generate summary
    if overall_sentiment["direction"] == "bullish":
        summary = f"Bullish signal ({overall_sentiment['confidence']}%)"
        if bullish_hits := overall_sentiment.get("bullish_hits", []):
            summary += f" - keywords: {', '.join(bullish_hits[:5])}"
    elif overall_sentiment["direction"] == "bearish":
        summary = f"Bearish signal ({overall_sentiment['confidence']}%)"
        if bearish_hits := overall_sentiment.get("bearish_hits", []):
            summary += f" - keywords: {', '.join(bearish_hits[:5])}"
    else:
        summary = "Neutral / mixed signals"
    
    return {
        "assets": asset_analysis,
        "overall": overall_sentiment["direction"],
        "score": overall_sentiment["score"],
        "confidence": overall_sentiment["confidence"],
        "summary": summary,
    }


def fetch_financialjuice_news():
    """Fetch and parse the FinancialJuice RSS feed."""
    req = urllib.request.Request(FJ_RSS_URL, headers={"User-Agent": "COT-Desk-Bot/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        content = resp.read().decode("utf-8")
    
    root = ET.fromstring(content)
    channel = root.find("channel")
    items = channel.findall("item")
    
    news = []
    for item in items:
        title_elem = item.find("title")
        pub_elem = item.find("pubDate")
        link_elem = item.find("link")
        desc_elem = item.find("description")
        cats = item.findall("category")
        
        title = title_elem.text if title_elem is not None else ""
        pub_date = pub_elem.text if pub_elem is not None else ""
        link = link_elem.text if link_elem is not None else ""
        desc_html = desc_elem.text if desc_elem is not None else ""
        desc = html_to_text(desc_html)
        categories = [c.text for c in cats if c.text]
        
        if not title:
            continue
        
        # Parse the date
        try:
            dt_obj = dt.datetime.strptime(pub_date, "%a, %d %b %Y %H:%M:%S %z")
            iso_date = dt_obj.isoformat()
        except:
            iso_date = pub_date
        
        # Analyze the news
        analysis = analyze_news_item(title, desc if desc else title)
        
        news_id = generate_id(title, pub_date)
        
        news.append({
            "id": news_id,
            "title": title,
            "pubDate": iso_date,
            "pubDateDisplay": pub_date,
            "categories": categories,
            "link": link,
            "description": desc[:500],
            "analysis": analysis,
        })
    
    return news


def fetch_forexfactory_calendar():
    """Fetch the ForexFactory economic calendar for this week."""
    req = urllib.request.Request(FF_CAL_URL, headers={"User-Agent": "COT-Desk-Bot/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    
    # Sort by date
    data.sort(key=lambda e: e.get("date", ""))
    
    return data


def main():
    os.makedirs(os.path.dirname(NEWS_JSON), exist_ok=True)
    
    # --- Fetch news ---
    print("Fetching FinancialJuice news...")
    try:
        news = fetch_financialjuice_news()
        print(f"  Got {len(news)} news items")
        
        # Merge with existing news if we have it
        existing_news = []
        if os.path.exists(NEWS_JSON):
            with open(NEWS_JSON) as f:
                try:
                    existing_data = json.load(f)
                    existing_news = existing_data.get("news", [])
                except:
                    pass
        
        # Merge: keep existing news that aren't in the new fetch, plus new ones
        existing_ids = {n["id"] for n in news}
        old_news = [n for n in existing_news if n["id"] not in existing_ids]
        merged = news + old_news[:30]  # keep last 30 old items
        # Sort by date descending
        merged.sort(key=lambda n: n.get("pubDate", ""), reverse=True)
        
        news_data = {
            "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
            "news": merged[:50],  # keep max 50 items
        }
        
        with open(NEWS_JSON, "w") as f:
            json.dump(news_data, f, indent=1)
        print(f"  Saved {len(news_data['news'])} items to {NEWS_JSON}")
    except Exception as e:
        print(f"  ERROR fetching news: {e}")
        # Keep existing news if fetch fails
        if not os.path.exists(NEWS_JSON):
            with open(NEWS_JSON, "w") as f:
                json.dump({"generated": dt.datetime.now(dt.timezone.utc).isoformat(), "news": []}, f)
    
    # --- Fetch calendar ---
    print("Fetching ForexFactory calendar...")
    try:
        events = fetch_forexfactory_calendar()
        print(f"  Got {len(events)} calendar events")
        
        cal_data = {
            "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
            "events": events,
        }
        
        with open(CALENDAR_JSON, "w") as f:
            json.dump(cal_data, f, indent=1)
        print(f"  Saved to {CALENDAR_JSON}")
    except Exception as e:
        print(f"  ERROR fetching calendar: {e}")
        if not os.path.exists(CALENDAR_JSON):
            with open(CALENDAR_JSON, "w") as f:
                json.dump({"generated": dt.datetime.now(dt.timezone.utc).isoformat(), "events": []}, f)
    
    print("\nDone!")


if __name__ == "__main__":
    main()
