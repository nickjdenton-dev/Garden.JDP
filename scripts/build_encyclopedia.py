#!/usr/bin/env python3
"""Bake Wikipedia + Wikidata + GBIF encyclopedia fields into library.json."""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "library.json"
CATALOG = ROOT / "scripts" / "garden_plants.json"
UA = "garden.jdp encyclopedia builder (https://garden.jdspharmacopeia.com; Wikipedia/Wikidata/GBIF)"
FAMILY_RANK = "Q35409"
ENCYCLOPEDIA_KEYS = (
    "extract",
    "image",
    "wiki_title",
    "wiki_url",
    "wikidata_id",
    "powo_id",
    "gbif_id",
    "native_range",
    "genus",
    "order",
    "taxon_rank",
    "links",
    "group",
)

CYCLES = {
    "dry": {
        "weekly_need_mm": 6,
        "kc": 0.2,
        "skip_if_rain_mm": 4,
        "lookback_hours": 168,
        "min_interval_days": 10,
        "max_interval_days": 21,
        "overwater_sensitive": True,
        "sprinkle_threshold_mm": 0.3,
        "hourly_cap_mm": 8,
        "dormant_months": [],
        "dormant_factor": 1,
        "water_method": "rare deep soak, then dry",
    },
    "average": {
        "weekly_need_mm": 18,
        "kc": 0.7,
        "skip_if_rain_mm": 12,
        "lookback_hours": 72,
        "min_interval_days": 3,
        "max_interval_days": 7,
        "overwater_sensitive": False,
        "sprinkle_threshold_mm": 0.7,
        "hourly_cap_mm": 10,
        "dormant_months": [],
        "dormant_factor": 1,
        "water_method": "deep soak",
    },
    "thirsty": {
        "weekly_need_mm": 28,
        "kc": 0.95,
        "skip_if_rain_mm": 18,
        "lookback_hours": 48,
        "min_interval_days": 1.5,
        "max_interval_days": 3.5,
        "overwater_sensitive": False,
        "sprinkle_threshold_mm": 0.7,
        "hourly_cap_mm": 12,
        "dormant_months": [],
        "dormant_factor": 1,
        "water_method": "deep soak",
    },
    "wet": {
        "weekly_need_mm": 34,
        "kc": 1,
        "skip_if_rain_mm": 22,
        "lookback_hours": 36,
        "min_interval_days": 1,
        "max_interval_days": 2.5,
        "overwater_sensitive": False,
        "sprinkle_threshold_mm": 0.8,
        "hourly_cap_mm": 12,
        "dormant_months": [],
        "dormant_factor": 1,
        "water_method": "deep soak",
    },
}


def get_json(url: str, retries: int = 3) -> dict | list | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=40) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as err:
            if attempt == retries - 1:
                print(f"FAIL {url} {err}")
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def looks_binomial(name: str) -> bool:
    text = re.sub(r"[\(\[].*", "", name or "").replace("×", "x").strip()
    return bool(re.match(r"^[A-Z][a-z]+(?:\s+x)?\s+[a-z]+$", text))


def infer_scientific(entry: dict, page: dict, taxon: dict) -> str:
    if entry.get("taxon"):
        return entry["taxon"]
    if taxon.get("taxon"):
        return taxon["taxon"]
    title = re.sub(r"\s*\([^)]+\)\s*$", "", page.get("title") or "").strip()
    if looks_binomial(title):
        return title
    extract = page.get("extract") or ""
    for pat in (
        r"produced by the (?:tropical )?tree ([A-Z][a-z]+ [a-z]+)",
        r"species of [^.]{0,60}?([A-Z][a-z]+ [a-z]+)",
        r"\b([A-Z][a-z]+ [a-z]+) is a species",
        r"tree ([A-Z][a-z]+ [a-z]+)",
    ):
        match = re.search(pat, extract)
        if match:
            return match.group(1)
    return entry.get("common_name") or title


def infer_cycle(parts: dict) -> str:
    text = " ".join(str(parts.get(key) or "") for key in ("title", "extract", "description", "taxon", "family")).lower()
    score = {"dry": 0, "average": 1, "thirsty": 0, "wet": 0}
    if re.search(
        r"cact|succulent|xerophyt|drought[- ]tolerant|arid|desert|agave|aloe|sedum|euphorbia|san pedro|trichocereus|echinopsis|crassula|lithops|jade|opuntia|kalanchoe|adenium",
        text,
    ):
        score["dry"] += 6
    if re.search(r"orchid|vanilla|epiphyt|tillandsia|bromeliad", text):
        score["dry"] += 2
    if re.search(
        r"banana|musa|tropic|ginger|turmeric|curcuma|heliconia|canna|veg|tomato|pepper|cucumber|squash|loofah|luffa|melon|basil|mango|papaya|avocado",
        text,
    ):
        score["thirsty"] += 5
    if re.search(r"wetland|marsh|bog|aquatic|rice|taro|colocasia|cyperus|papyrus|lotus|nymphaea", text):
        score["wet"] += 6
    if re.search(r"rainforest|moisture-lov|evenly moist|keep moist", text):
        score["thirsty"] += 3
    if re.search(r"well[- ]drained|moderate water|established trees are|citrus", text):
        score["average"] += 2
    if re.search(r"cactaceae|asphodelaceae|crassulaceae|aizoaceae|agavaceae|euphorbiaceae", text):
        score["dry"] += 4
    if re.search(r"musaceae|zingiberaceae|cucurbitaceae", text):
        score["thirsty"] += 4
    if re.search(r"araceae|cyperaceae|nelumbonaceae", text):
        score["wet"] += 3
    return sorted(score.items(), key=lambda item: item[1], reverse=True)[0][0]


def apply_cycle(species: dict, cycle_id: str) -> dict:
    cycle = CYCLES.get(cycle_id) or CYCLES["average"]
    species.update(cycle)
    species["water_cycle"] = cycle_id
    return species


def wiki_pages(titles: list[str]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for batch in chunks(titles, 20):
        params = {
            "action": "query",
            "format": "json",
            "origin": "*",
            "redirects": "1",
            "prop": "extracts|pageimages|pageprops|info",
            "exintro": "1",
            "explaintext": "1",
            "exlimit": "20",
            "piprop": "thumbnail",
            "pithumbsize": "800",
            "inprop": "url",
            "ppprop": "wikibase_item",
            "titles": "|".join(batch),
        }
        data = get_json("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params)) or {}
        query = data.get("query") or {}
        redirects = {row["from"]: row["to"] for row in query.get("redirects") or []}
        normalized = {row["from"]: row["to"] for row in query.get("normalized") or []}
        pages = {page.get("title"): page for page in (query.get("pages") or {}).values() if page.get("pageid")}
        for title in batch:
            resolved = redirects.get(normalized.get(title, title), normalized.get(title, title))
            resolved = redirects.get(resolved, resolved)
            page = pages.get(resolved)
            if not page or page.get("extract", "").lower().startswith(resolved.lower() + " may refer to"):
                continue
            found[title] = page
        time.sleep(0.15)
    return found


def claim_values(claims: dict, prop: str) -> list:
    values = []
    for claim in claims.get(prop) or []:
        snak = (claim.get("mainsnak") or {}).get("datavalue") or {}
        kind = snak.get("type")
        value = snak.get("value")
        if kind == "wikibase-entityid" and isinstance(value, dict):
            values.append(value.get("id"))
        elif kind in {"string", "monolingualtext"}:
            values.append(value.get("text") if isinstance(value, dict) else value)
        elif value is not None:
            values.append(value)
    return [item for item in values if item]


def wikidata_entities(ids: list[str]) -> dict[str, dict]:
    entities: dict[str, dict] = {}
    clean = [qid for qid in ids if qid]
    for batch in chunks(clean, 40):
        params = {
            "action": "wbgetentities",
            "ids": "|".join(batch),
            "props": "labels|descriptions|claims",
            "languages": "en",
            "format": "json",
            "origin": "*",
        }
        data = get_json("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(params)) or {}
        entities.update(data.get("entities") or {})
        time.sleep(0.1)
    return entities


def walk_family(qid: str, entities: dict[str, dict], missing: list[str]) -> str:
    seen = set()
    current = qid
    while current and current not in seen:
        seen.add(current)
        ent = entities.get(current)
        if not ent or "claims" not in ent:
            missing.append(current)
            return ""
        claims = ent.get("claims") or {}
        ranks = claim_values(claims, "P105")
        if FAMILY_RANK in ranks:
            return ((ent.get("labels") or {}).get("en") or {}).get("value") or ""
        parents = claim_values(claims, "P171")
        current = parents[0] if parents else None
    return ""


def gbif_record(name: str) -> dict:
    if not name:
        return {}
    match = get_json("https://api.gbif.org/v1/species/match?" + urllib.parse.urlencode({"name": name})) or {}
    if not match.get("usageKey") or match.get("matchType") == "NONE":
        return {}
    key = match["usageKey"]
    native = []
    descriptions = get_json(f"https://api.gbif.org/v1/species/{key}/descriptions") or {}
    for row in descriptions.get("results") or []:
        if str(row.get("type") or "").lower() in {"native range", "distribution", "habitat"}:
            text = (row.get("description") or "").strip()
            if text and text not in native and len(text) < 180:
                native.append(text)
        if len(native) >= 3:
            break
    time.sleep(0.05)
    return {
        "gbif_id": key,
        "family": match.get("family") or "",
        "genus": match.get("genus") or "",
        "order": match.get("order") or "",
        "scientific_name": match.get("canonicalName") or match.get("scientificName") or name,
        "taxon_rank": (match.get("rank") or "").lower(),
        "native_range": "; ".join(native[:3]),
    }


def encyclopedia_fields(page: dict, taxon: dict, gbif: dict, group: str) -> dict:
    extract = (page.get("extract") or "").strip()
    if len(extract) > 900:
        extract = extract[:897].rsplit(" ", 1)[0] + "…"
    thumb = ((page.get("thumbnail") or {}).get("source") or "").split("?")[0]
    qid = taxon.get("qid") or (page.get("pageprops") or {}).get("wikibase_item") or ""
    powo_id = taxon.get("powo_id") or ""
    gbif_id = gbif.get("gbif_id") or taxon.get("gbif_id") or ""
    links = []
    wiki_url = page.get("fullurl") or ""
    if wiki_url:
        links.append({"title": "Wikipedia", "url": wiki_url})
    if powo_id:
        links.append({"title": "Plants of the World Online", "url": f"https://powo.science.kew.org/taxon/{powo_id}"})
    if gbif_id:
        links.append({"title": "GBIF", "url": f"https://www.gbif.org/species/{gbif_id}"})
    if qid:
        links.append({"title": "Wikidata", "url": f"https://www.wikidata.org/wiki/{qid}"})
    return {
        "extract": extract,
        "image": thumb,
        "wiki_title": page.get("title") or "",
        "wiki_url": wiki_url,
        "wikidata_id": qid,
        "powo_id": powo_id,
        "gbif_id": gbif_id,
        "native_range": gbif.get("native_range") or "",
        "genus": gbif.get("genus") or taxon.get("genus") or "",
        "order": gbif.get("order") or "",
        "taxon_rank": gbif.get("taxon_rank") or "",
        "links": links,
        "group": group,
    }


def new_species(entry: dict, page: dict, taxon: dict, gbif: dict) -> dict:
    extract = (page.get("extract") or "").strip()
    scientific = taxon.get("taxon") or gbif.get("scientific_name") or infer_scientific(entry, page, taxon)
    family = taxon.get("family") or gbif.get("family") or ""
    cycle = infer_cycle(
        {
            "title": entry["common_name"],
            "extract": extract,
            "description": taxon.get("description") or "",
            "taxon": scientific,
            "family": family,
        }
    )
    species = {
        "id": entry["id"],
        "common_name": entry["common_name"],
        "scientific_name": scientific,
        "family": family,
        "roles": entry.get("roles") or ["encyclopedia"],
        "toxicity": entry.get("toxicity") or "none",
        "edible_parts": "",
        "sun": "",
        "soil": "",
        "placement": "",
        "amendments": [],
        "notes": [extract] if extract else [],
        "warnings": ["Toxic. Keep off the food path."] if entry.get("toxicity") == "high" else [],
        "climate_fit": "unknown",
        "encyclopedia": True,
    }
    species.update(encyclopedia_fields(page, taxon, gbif, entry.get("group") or "Encyclopedia"))
    return apply_cycle(species, cycle)


def main() -> None:
    catalog = json.loads(CATALOG.read_text())
    library = json.loads(LIBRARY.read_text())
    pages = wiki_pages([entry["wiki"] for entry in catalog])
    qids = []
    for entry in catalog:
        page = pages.get(entry["wiki"])
        if page:
            qid = (page.get("pageprops") or {}).get("wikibase_item")
            if qid:
                qids.append(qid)
    entities = wikidata_entities(qids)
    missing_parents: list[str] = []
    for qid, ent in list(entities.items()):
        walk_family(qid, entities, missing_parents)
    extra = [qid for qid in missing_parents if qid not in entities]
    while extra:
        entities.update(wikidata_entities(extra))
        missing_parents = []
        for qid in qids:
            walk_family(qid, entities, missing_parents)
        extra = [qid for qid in missing_parents if qid not in entities]

    taxa = {}
    for qid in qids:
        ent = entities.get(qid) or {}
        claims = ent.get("claims") or {}
        family_missing: list[str] = []
        family = walk_family(qid, entities, family_missing)
        taxa[qid] = {
            "qid": qid,
            "taxon": (claim_values(claims, "P225") or [None])[0] or "",
            "powo_id": (claim_values(claims, "P5037") or [None])[0] or "",
            "gbif_id": (claim_values(claims, "P846") or [None])[0] or "",
            "genus": ((entities.get((claim_values(claims, "P171") or [None])[0] or "") or {}).get("labels") or {}).get("en", {}).get("value")
            or "",
            "family": family,
            "description": ((ent.get("descriptions") or {}).get("en") or {}).get("value") or "",
        }

    added = 0
    enriched = 0
    skipped = []
    for entry in catalog:
        page = pages.get(entry["wiki"])
        if not page:
            skipped.append(entry["wiki"])
            continue
        qid = (page.get("pageprops") or {}).get("wikibase_item") or ""
        taxon = taxa.get(qid, {"qid": qid})
        scientific = infer_scientific(entry, page, taxon)
        gbif = gbif_record(scientific)
        if not gbif.get("family"):
            gbif = gbif_record(entry["common_name"]) or gbif
        if entry.get("existing"):
            species = library["species"].get(entry["id"])
            if not species:
                skipped.append(entry["id"])
                continue
            fields = encyclopedia_fields(page, taxon, gbif, entry.get("group") or species.get("group") or "")
            for key, value in fields.items():
                if key in {"group", "links"} or not species.get(key):
                    if value:
                        species[key] = value
            enriched += 1
            continue
        library["species"][entry["id"]] = new_species(entry, page, taxon, gbif)
        added += 1

    library["encyclopedia"] = {
        "title": "Garden encyclopedia",
        "sources": [
            "Wikipedia (CC BY-SA)",
            "Wikidata (CC0)",
            "GBIF Backbone Taxonomy",
            "Plants of the World Online / Kew (linked via Wikidata P5037)",
        ],
        "citation": "POWO (2019). Plants of the World Online. Facilitated by the Royal Botanic Gardens, Kew. Published on the Internet; http://www.plantsoftheworldonline.org/",
    }
    for species in library["species"].values():
        if species.get("extract"):
            continue
        title = species.get("wiki_title") or species.get("common_name")
        summary = get_json(
            "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title)
        ) or {}
        extract = (summary.get("extract") or "").strip()
        if extract:
            species["extract"] = extract if len(extract) <= 900 else extract[:897].rsplit(" ", 1)[0] + "…"
            if species.get("encyclopedia") and not species.get("notes"):
                species["notes"] = [extract]
        thumb = ((summary.get("thumbnail") or {}).get("source") or "").split("?")[0]
        if thumb and not species.get("image"):
            species["image"] = thumb
        time.sleep(0.05)
    LIBRARY.write_text(json.dumps(library, indent=2, ensure_ascii=False) + "\n")
    print(f"enriched {enriched} added {added} skipped {skipped} total {len(library['species'])}")


if __name__ == "__main__":
    main()
