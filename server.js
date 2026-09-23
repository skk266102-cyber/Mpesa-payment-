const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "20kb" }));
app.use(express.static("public"));

const PORT = Number(process.env.PORT || 10000);
const SANDBOX_BASE = "https://sandbox.safaricom.co.ke";

const required = [
  "CONSUMER_KEY",
  "CONSUMER_SECRET",
  "BUSINESS_SHORT_CODE",
  "MPESA_PASSKEY",
  "PUBLIC_BASE_URL"
];

function configError() {
  return required.filter((key) => !process.env[key]);
}

function normalizePhone(input) {
  let phone = String(input || "").replace(/\s+/g, "").replace(/^\+/, "");

  if (phone.startsWith("0")) {
    phone = "254" + phone.slice(1);
  }

  if (/^7\d{8}$/.test(phone)) {
    phone = "254" + phone;
  }

  if (!/^2547\d{8}$/.test(phone)) {
    return null;
  }

  return phone;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function passwordFor(shortCode, passkey, time) {
  return Buffer.from(`${shortCode}${passkey}${time}`).toString("base64");
}

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
  ).toString("base64");

  const response = await fetch(
    `${SANDBOX_BASE}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json"
      }
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.errorMessage || "Could not obtain Daraja access token."
    );
  }

  return data.access_token;
}

// Temporary in-memory transaction store.
// It is intentionally not presented as permanent accounting storage.
// Render Free services can restart, so use a database before relying on this for accounting.
const transactions = new Map();

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/stkpush", async (req, res) => {
  try {
    const missing = configError();
    if (missing.length) {
      return res.status(500).json({
        ok: false,
        message: "Server is not configured yet.",
        missing
      });
    }

    const amount = Number(req.body.amount);
    const phone = normalizePhone(req.body.phone);

    if (!Number.isInteger(amount) || amount < 1 || amount > 150000) {
      return res.status(400).json({
        ok: false,
        message: "Enter a whole-number amount between KSh 1 and KSh 150,000."
      });
    }

    if (!phone) {
      return res.status(400).json({
        ok: false,
        message: "Enter a valid Kenyan M-PESA number, e.g. 0712345678."
      });
    }

    const accessToken = await getAccessToken();
    const time = timestamp();
    const shortCode = process.env.BUSINESS_SHORT_CODE;
    const callBackURL =
      `${process.env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/mpesa/callback`;

    const payload = {
      BusinessShortCode: shortCode,
      Password: passwordFor(shortCode, process.env.MPESA_PASSKEY, time),
      Timestamp: time,
      TransactionType:
        process.env.TRANSACTION_TYPE || "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: shortCode,
      PhoneNumber: phone,
      CallBackURL: callBackURL,
      AccountReference:
        process.env.ACCOUNT_REFERENCE || "PAYMENT",
      TransactionDesc:
        process.env.TRANSACTION_DESC || "Business payment"
    };

    const response = await fetch(
      `${SANDBOX_BASE}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        message:
          data.errorMessage ||
          data.error_description ||
          "Daraja rejected the STK Push request."
      });
    }

    const checkoutRequestID = data.CheckoutRequestID || crypto.randomUUID();

    transactions.set(checkoutRequestID, {
      checkoutRequestID,
      phone,
      amount,
      status: "PENDING",
      createdAt: new Date().toISOString()
    });

    return res.json({
      ok: true,
      message:
        data.CustomerMessage ||
        "Payment prompt sent. Check the M-PESA prompt on your phone.",
      checkoutRequestID,
      merchantRequestID: data.MerchantRequestID || null,
      responseCode: data.ResponseCode || null
    });
  } catch (error) {
    console.error("STK Push error:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Could not send the payment prompt. Check the server configuration."
    });
  }
});

app.post("/api/mpesa/callback", (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;

    if (callback) {
      const id = callback.CheckoutRequestID;
      const existing = transactions.get(id);

      let status = "FAILED";
      let resultCode = callback.ResultCode;
      let resultDesc = callback.ResultDesc || "Payment failed.";

      if (Number(callback.ResultCode) === 0) {
        status = "SUCCESS";
        resultDesc = "Payment completed.";

        const items = callback.CallbackMetadata?.Item || [];
        const metadata = {};
        for (const item of items) {
          if (item.Name) metadata[item.Name] = item.Value;
        }

        if (existing) {
          existing.mpesaReceiptNumber = metadata.MpesaReceiptNumber || null;
          existing.transactionDate = metadata.TransactionDate || null;
          existing.amount = Number(metadata.Amount || existing.amount);
          existing.phone = String(metadata.PhoneNumber || existing.phone);
        }
      }

      if (existing) {
        existing.status = status;
        existing.resultCode = resultCode;
        existing.resultDesc = resultDesc;
        existing.updatedAt = new Date().toISOString();
      }
    }
  } catch (error) {
    console.error("Callback processing error:", error.message);
  }

  // Safaricom expects an acknowledgement response.
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

app.get("/api/status/:checkoutRequestID", (req, res) => {
  const record = transactions.get(req.params.checkoutRequestID);

  if (!record) {
    return res.status(404).json({
      ok: false,
      message: "Transaction not found on this server."
    });
  }

  res.json({ ok: true, transaction: record });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`M-PESA payment page listening on port ${PORT}`);
});
