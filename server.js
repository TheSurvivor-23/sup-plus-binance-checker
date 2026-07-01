import crypto from "node:crypto";
import http from "node:http";

const PORT = process.env.PORT || 3000;

function json(res, data, statusCode = 200) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sign(query, secret) {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname !== "/check") {
      return json(res, {
        ok: true,
        message: "SUP Plus Binance checker is running. Use /check?coin=USDT&amount=20"
      });
    }

    const apiKey = process.env.BINANCE_API_KEY;
    const secretKey = process.env.BINANCE_SECRET_KEY;

    if (!apiKey || !secretKey) {
      return json(res, {
        paid: false,
        error: "Missing Binance API environment variables"
      }, 500);
    }

    const coin = url.searchParams.get("coin") || "USDT";
    const expectedAmount = Number(url.searchParams.get("amount") || "0");

    if (!expectedAmount || expectedAmount <= 0) {
      return json(res, {
        paid: false,
        error: "Missing or invalid amount"
      }, 400);
    }

    const now = Date.now();
    const startTime = Number(
      url.searchParams.get("startTime") || now - 6 * 60 * 60 * 1000
    );

    const params = new URLSearchParams({
      coin,
      status: "1",
      startTime: String(startTime),
      recvWindow: "60000",
      timestamp: String(now)
    });

    const query = params.toString();
    const signature = sign(query, secretKey);

    const binanceUrl =
      `https://api.binance.com/sapi/v1/capital/deposit/hisrec?${query}&signature=${signature}`;

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
    } catch {
      return json(res, {
        paid: false,
        error: "Invalid Binance response",
        httpStatus: binanceResponse.status,
        raw: text
      });
    }

    if (!Array.isArray(data)) {
      return json(res, {
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
      return json(res, {
        paid: true,
        status: "PAID",
        amount: match.amount,
        coin: match.coin,
        network: match.network || "",
        txId: match.txId || "",
        insertTime: match.insertTime || ""
      });
    }

    return json(res, {
      paid: false,
      status: "NOT_FOUND",
      message: "No matching successful deposit found"
    });
  } catch (err) {
    return json(res, {
      paid: false,
      error: err.message
    }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`SUP Plus Binance checker running on port ${PORT}`);
});
