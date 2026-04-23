export default async function handler(req, res) {
  const URL = "https://apps.fas.usda.gov/esrqs/StaticReports/CWRCommoditySummary.xml";
  try {
    const r = await fetch(URL, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/xml, text/xml, */*" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "text/xml; charset=utf-8");
    res.status(200).send(text);
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).send(`Erro: ${e.message}`);
  }
}
