function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

async function hmacSha256(message, secret) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );

  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);

    if (url.pathname !== "/check") {
      return json({
        ok: true,
        message: "SUP Plus Binance checker is running. Use /check?coin=USDT&amount=20"
      });
    }

    const apiKey = Deno.env.get("BINANCE_API_KEY");
    const secretKey = Deno.env.get("BINANCE_SECRET_KEY");

    if (!apiKey || !secretKey) {
      return json({
        paid: false,
        error: "Missing Binance API environment variables"
      }, 500);
    }

    const coin = url.searchParams.get("coin") || "USDT";
    const expectedAmount = Number(url.searchParams.get("amount") || "0");

    if (!expectedAmount || expectedAmount <= 0) {
      return json({
        paid: false,
        error: "Missing or invalid amount"
      }, 400);
    }

    const now = Date.now();
    const startTime = Number(
      url.searchParams.get("startTime") || now - 6 * 60 * 60 * 1000
    );

    const params = new URLSearchParams({
      coin: coin,
      status: "1",
      startTime: String(startTime),
      recvWindow: "60000",
      timestamp: String(now)
    });

    const query = params.toString();
    const signature = await hmacSha256(query, secretKey);

    const binanceUrl =
      "https://api.binance.com/sapi/v1/capital/deposit/hisrec?" +
      query +
      "&signature=" +
      signature;

    const binanceResponse = await fetch(binanceUrl, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": apiKey
      }
    });

    const text = await binanceResponse.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (_error) {
      return json({
        paid: false,
        error: "Invalid Binance response",
        httpStatus: binanceResponse.status,
        raw: text
      });
    }

    if (!Array.isArray(data)) {
      return json({
        paid: false,
        error: "Binance API error",
        httpStatus: binanceResponse.status,
        raw: data
      });
    }

    const match = data.find((item) => {
      const amount = Number(item.amount);

      return (
        item.coin === coin &&
        Number(item.status) === 1 &&
        Math.abs(amount - expectedAmount) < 0.000001
      );
    });

    if (match) {
      return json({
        paid: true,
        status: "PAID",
        amount: match.amount,
        coin: match.coin,
        network: match.network || "",
        txId: match.txId || "",
        insertTime: match.insertTime || ""
      });
    }

    return json({
      paid: false,
      status: "NOT_FOUND",
      message: "No matching successful deposit found"
    });
  } catch (error) {
    return json({
      paid: false,
      error: error.message
    }, 500);
  }
});
