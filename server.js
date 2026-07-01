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

function cleanTxId(value) {
  return String(value || "").trim().toLowerCase();
}

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);

    if (url.pathname !== "/check") {
      return json({
        ok: true,
        message: "SUP Plus Binance checker is running. Use /check?coin=USDT&amount=20&txId=YOUR_TXID"
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
    const txIdInput = cleanTxId(url.searchParams.get("txId"));

    if (!expectedAmount || expectedAmount <= 0) {
      return json({
        paid: false,
        error: "Missing or invalid amount"
      }, 400);
    }

    if (!txIdInput) {
      return json({
        paid: false,
        error: "Missing TXID",
        message: "Please provide txId in the URL"
      }, 400);
    }

    const now = Date.now();

    // نفحص آخر 24 ساعة
    const startTime = Number(
      url.searchParams.get("startTime") || now - 24 * 60 * 60 * 1000
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

    const txMatch = data.find((item) => {
      const itemTxId = cleanTxId(item.txId);
      return itemTxId === txIdInput;
    });

    if (!txMatch) {
      return json({
        paid: false,
        status: "NOT_FOUND",
        message: "No successful deposit found with this TXID"
      });
    }

    const receivedAmount = Number(txMatch.amount);

    if (Math.abs(receivedAmount - expectedAmount) > 0.000001) {
      return json({
        paid: false,
        status: "AMOUNT_MISMATCH",
        expectedAmount: expectedAmount,
        receivedAmount: txMatch.amount,
        coin: txMatch.coin,
        network: txMatch.network || "",
        txId: txMatch.txId || "",
        message: "TXID found, but amount does not match"
      });
    }

    return json({
      paid: true,
      status: "PAID",
      amount: txMatch.amount,
      coin: txMatch.coin,
      network: txMatch.network || "",
      txId: txMatch.txId || "",
      insertTime: txMatch.insertTime || ""
    });
  } catch (error) {
    return json({
      paid: false,
      error: error.message
    }, 500);
  }
});
