exports.handler = async () => {
  const INDEX = "https://esmis.nal.usda.gov/publication/crop-progress";
  try {
    const pageRes = await fetch(INDEX, { headers: { "User-Agent": "Mozilla/5.0" } });
    const html    = await pageRes.text();

    // Find the most recent .txt release file link
    const match = html.match(/href="(https:\/\/esmis\.nal\.usda\.gov\/sites\/default\/release-files\/[^"]+\.txt)"/);
    if (!match) return { statusCode: 404, body: "Link do .txt não encontrado na página do ESMIS" };

    const txtRes = await fetch(match[1]);
    const text   = await txtRes.text();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
      body: text,
    };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
