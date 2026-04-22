exports.handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain; charset=utf-8" };

  // Se passar ?url=... na query, usa direto (modo manual)
  const manualUrl = event.queryStringParameters?.url;
  if (manualUrl && manualUrl.includes("esmis.nal.usda.gov")) {
    try {
      const res = await fetch(manualUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { statusCode: 200, headers, body: await res.text() };
    } catch (e) {
      return { statusCode: 500, headers, body: `Erro ao buscar URL manual: ${e.message}` };
    }
  }

  // Automático: tenta o JSON:API do Drupal com campos explícitos
  async function tryJsonApi() {
    const endpoints = [
      "https://esmis.nal.usda.gov/jsonapi/node/publication_release?filter[field_publication.field_short_name]=crop-progress&sort=-created&page[limit]=1&include=field_files",
      "https://esmis.nal.usda.gov/jsonapi/node/publication_release?filter[field_publication.field_short_name]=crop-progress&sort=-field_release_date&page[limit]=1",
    ];
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { headers: { "Accept": "application/vnd.api+json", "User-Agent": "Mozilla/5.0" } });
        if (!res.ok) continue;
        const json = await res.json();
        const d = json?.data?.[0];
        if (!d) continue;
        // Try various attribute paths where the txt URL might live
        const candidates = [
          d?.attributes?.field_file_txt?.uri?.url,
          d?.attributes?.field_files?.[0]?.uri?.url,
        ].filter(Boolean);
        for (const c of candidates) {
          if (c?.endsWith(".txt")) return c.startsWith("http") ? c : "https://esmis.nal.usda.gov" + c;
        }
        // Try included files
        const included = json?.included || [];
        for (const inc of included) {
          const uri = inc?.attributes?.uri?.url || inc?.attributes?.url;
          if (uri?.endsWith(".txt")) return uri.startsWith("http") ? uri : "https://esmis.nal.usda.gov" + uri;
        }
      } catch {}
    }
    return null;
  }

  // Tenta o endpoint de release individual por data calculada
  async function tryByDate() {
    const now = new Date();
    for (let offset = 0; offset <= 3; offset++) {
      const d = new Date(now);
      d.setDate(d.getDate() - offset * 7);
      // Achar segunda-feira desta semana
      const dow = d.getUTCDay(); // 0=dom
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
      const dateStr = monday.toISOString().split("T")[0];
      const url = `https://esmis.nal.usda.gov/publication/crop-progress/${dateStr}`;
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" } });
        if (!res.ok) continue;
        const html = await res.text();
        const m = html.match(/https:\/\/esmis\.nal\.usda\.gov\/sites\/default\/release-files\/[^"'\s]+\.txt/);
        if (m) return m[0];
      } catch {}
    }
    return null;
  }

  try {
    let txtUrl = await tryJsonApi() || await tryByDate();

    if (!txtUrl) {
      return {
        statusCode: 404,
        headers,
        body: [
          "Não foi possível localizar o arquivo automaticamente.",
          "Use o modo manual: adicione ?url=LINK_DO_TXT na chamada da função.",
          `Exemplo: /.netlify/functions/proxy-crop?url=https://esmis.nal.usda.gov/sites/default/release-files/795867/prog1626.txt`,
        ].join("\n"),
      };
    }

    const res = await fetch(txtUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${txtUrl}`);
    return { statusCode: 200, headers, body: await res.text() };

  } catch (e) {
    return { statusCode: 500, headers, body: `Erro: ${e.message}` };
  }
};
