const RaincheckEncyclopedia = (() => {
  function val(row, key) {
    return (row && row[key] && row[key].value) || "";
  }

  async function facts(qid) {
    if (!qid) return {};
    const query = `SELECT ?taxon ?familyLabel ?powo ?gbif WHERE {
      BIND(wd:${qid} AS ?item)
      OPTIONAL { ?item wdt:P225 ?taxon }
      OPTIONAL { ?item wdt:P5037 ?powo }
      OPTIONAL { ?item wdt:P846 ?gbif }
      OPTIONAL { ?item wdt:P171* ?family . ?family wdt:P105 wd:Q35409 }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 1`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const response = await fetch(`https://query.wikidata.org/sparql?${new URLSearchParams({ query, format: "json" })}`, {
        headers: { Accept: "application/sparql-results+json" },
        signal: ctrl.signal,
      });
      if (!response.ok) return {};
      const data = await response.json();
      const row = data.results && data.results.bindings && data.results.bindings[0];
      return {
        taxon: val(row, "taxon"),
        family: val(row, "familyLabel"),
        powo_id: val(row, "powo"),
        gbif_id: val(row, "gbif"),
      };
    } catch {
      return {};
    } finally {
      clearTimeout(timer);
    }
  }

  function links(info) {
    const out = [];
    if (info.wiki_url) out.push({ title: "Wikipedia", url: info.wiki_url });
    if (info.powo_id) out.push({ title: "Plants of the World Online", url: `https://powo.science.kew.org/taxon/${info.powo_id}` });
    if (info.gbif_id) out.push({ title: "GBIF", url: `https://www.gbif.org/species/${info.gbif_id}` });
    if (info.wikidata_id) out.push({ title: "Wikidata", url: `https://www.wikidata.org/wiki/${info.wikidata_id}` });
    return out;
  }

  return { facts, links };
})();
