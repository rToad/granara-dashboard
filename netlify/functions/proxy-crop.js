exports.handler = async () => {
  // The ESMIS index page blocks server-side fetch (403).
  // Strategy 1: ESMIS JSON:API endpoint (Drupal) — clean, no scraping.
  // Strategy 2: Scrape the specific release page by calculated ISO week date.

  function getWeekCandidates() {
    const now = new Date();
    const results = [];
    for (let offset = 0; offset <= 2; offset++) {
      const d = new Date(now);
      d.setDate(d.getDate() - offset * 7);
      const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dow = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dow);
      const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
      // Get Monday of this ISO week
      const jan4 = new Date(Date.UTC(d.getFullYear(), 0, 4));
      const jan4dow = jan4.getUTCDay() || 7;
      const firstMon = new Date(jan4);
      firstMon.setUTCDate(jan4.getUTCDate() - (jan4dow - 1));
      const monday = new Date(firstMon);
      monday.setUTCDate(firstMon.getUTCDate() + (week - 1) * 7);
      results.push(monday.toISOString().split("T")[0]); // e.g. "2026-04-20"
    }
    return results;
  }

  async function tryJsonApi() {
    const url = "https://esmis.nal.usda.gov/jsonapi/node/publication_release" +
      "?filter[field_publication.field_short_name]=crop-progress" +
      "&sort=-field_release_date&page[limit]=1";
    try {
      const res = await fetch(url, {
        headers: { "Accept": "application/vnd.api+json", "User-Agent": "Mozilla/5.0" }
      });
      if (!res.ok) return null;
      const json = await res.json();
      const fileUrl = json?.data?.[0]?.attributes?.field_file_txt?.uri?.url;
      if (fileUrl) return fileUrl.startsWith("http") ? fileUrl : "https://esmis.nal.usda.gov" + fileUrl;
    } catch {}
    return null;
  }

  async function tryReleasePage(dateStr) {
    const url = `https://esmis.nal.usda.gov/publication/crop-progress/${dateStr}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) return null;
      const html = await res.text();
      const m = html.match(/href="(https:\/\/esmis\.nal\.usda\.gov\/sites\/default\/release-files\/[^"]+\.txt)"/);
      return m ? m[1] : null;
    } catch {}
    return null;
  }

  try {
    let txtUrl = await tryJsonApi();

    if (!txtUrl) {
      for (const dateStr of getWeekCandidates()) {
        txtUrl = await tryReleasePage(dateStr);
        if (txtUrl) break;
      }
    }

    if (!txtUrl) {
      return {
        statusCode: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "Arquivo não encontrado. O relatório é publicado às 17h ET toda segunda-feira.",
      };
    }

    const txtRes = await fetch(txtUrl);
    if (!txtRes.ok) throw new Error(`HTTP ${txtRes.status} ao buscar ${txtUrl}`);
    const text = await txtRes.text();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
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
