exports.handler = async () => {
  const URL = "https://apps.fas.usda.gov/esrqs/StaticReports/CWRCommoditySummary.xml";
  try {
    const res = await fetch(URL, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/xml, text/xml, */*" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
      body: text,
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: `Erro: ${e.message}`,
    };
  }
};
