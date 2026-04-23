export default async function handler(req, res) {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain; charset=utf-8" };

  // Modo manual: ?url=...
  const manualUrl = req.query?.url;
  if (manualUrl && manualUrl.includes("esmis.nal.usda.gov")) {
    try {
      const r = await fetch(manualUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(200).send(await r.text());
    } catch (e) {
      Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(500).send(`Erro ao buscar URL manual: ${e.message}`);
    }
  }

  // Automático via JSON:API
  async function tryJsonApi() {
    const endpoints = [
      "https://esmis.nal.usda.gov/jsonapi/node/publication_release?filter[field_publication.field_short_name]=crop-progress&sort=-created&page[limit]=1&include=field_files",
      "https://esmis.nal.usda.gov/jsonapi/node/publication_release?filter[field_publication.field_short_name]=crop-progress&sort=-field_release_date&page[limit]=1",
    ];
    for (const url of endpoints) {
      try {
        const r = await fetch(url, { headers: { "Accept": "application/vnd.api+json", "User-Agent": "Mozilla/5.0" } });
        if (!r.ok) continue;
        const json = await r.json();
        const d = json?.data?.[0];
        if (!d) continue;
        const candidates = [
          d?.attributes?.field_file_txt?.uri?.url,
          d?.attributes?.field_files?.[0]?.uri?.url,
        ].filter(Boolean);
        for (const c of candidates) {
          if (c?.endsWith(".txt")) return c.startsWith("http") ? c : "https://esmis.nal.usda.gov" + c;
        }
        const included = json?.included || [];
        for (const inc of included) {
          const uri = inc?.attributes?.uri?.url || inc?.attributes?.url;
          if (uri?.endsWith(".txt")) return uri.startsWith("http") ? uri : "https://esmis.nal.usda.gov" + uri;
        }
      } catch {}
    }
    return null;
  }

  // Fallback por data
  async function tryByDate() {
    const now = new Date();
    for (let offset = 0; offset <= 3; offset++) {
      const d = new Date(now);
      d.setDate(d.getDate() - offset * 7);
      const dow = d.getUTCDay();
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
      const dateStr = monday.toISOString().split("T")[0];
      const url = `https://esmis.nal.usda.gov/publication/crop-progress/${dateStr}`;
      try {
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" } });
        if (!r.ok) continue;
        const html = await r.text();
        const m = html.match(/https:\/\/esmis\.nal\.usda\.gov\/sites\/default\/release-files\/[^"'\s]+\.txt/);
        if (m) return m[0];
      } catch {}
    }
    return null;
  }

  try {
    const txtUrl = await tryJsonApi() || await tryByDate();
    if (!txtUrl) {
      Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(404).send([
        "Não foi possível localizar o arquivo automaticamente.",
        "Use o modo manual: adicione ?url=LINK_DO_TXT na chamada da função.",
        "Exemplo: /api/proxy-crop?url=https://esmis.nal.usda.gov/sites/default/release-files/795867/prog1626.txt",
      ].join("\n"));
    }
    const r = await fetch(txtUrl);
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${txtUrl}`);
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.status(200).send(await r.text());
  } catch (e) {
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.status(500).send(`Erro: ${e.message}`);
  }
}
