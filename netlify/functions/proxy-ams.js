exports.handler = async () => {
  const URL = "https://www.ams.usda.gov/mnreports/wa_gr101.txt";
  try {
    const res  = await fetch(URL);
    const text = await res.text();
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
