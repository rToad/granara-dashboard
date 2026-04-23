export default async function handler(req, res) {
  const URL = "https://www.ams.usda.gov/mnreports/wa_gr101.txt";
  try {
    const r = await fetch(URL);
    const text = await r.text();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(text);
  } catch (e) {
    res.status(500).send(e.message);
  }
}
