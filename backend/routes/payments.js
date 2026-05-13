const crypto = require("crypto");
const router = require("express").Router();
const pool = require("../db/pool");
const { authenticate, authorizeUser } = require("../middleware/auth");
const { applyWalletChange, roundMoney } = require("../utils/walletLedger");
const { createNotification } = require("../utils/notificationHelper");
const { sendEmail } = require("../utils/sendEmail");
const { walletTopUp } = require("../utils/emailTemplates");

const MIN_TOPUP_NPR = 10;
const MAX_TOPUP_NPR = 500_000;

function getSiteUrl() {
  return process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

function getKhaltiBaseUrl() {
  return process.env.KHALTI_BASE_URL || "https://dev.khalti.com/api/v2";
}

function mapKhaltiStatus(status) {
  switch (String(status || "").toLowerCase()) {
    case "completed":
      return "completed";
    case "pending":
      return "pending";
    case "expired":
      return "expired";
    case "user canceled":
    case "user canceled by the user":
    case "canceled":
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

async function khaltiPost(path, payload) {
  const secretKey = process.env.KHALTI_SECRET_KEY;
  if (!secretKey) {
    const err = new Error("Khalti secret key is not configured.");
    err.statusCode = 500;
    throw err;
  }

  const res = await fetch(`${getKhaltiBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_err) {
    data = { error: raw || "Unable to parse Khalti response" };
  }

  if (!res.ok) {
    const err = new Error(
      data.detail || data.error_key || "Khalti request failed.",
    );
    err.statusCode = res.status;
    err.meta = data;
    throw err;
  }

  return data;
}

router.post(
  "/khalti/initiate",
  authenticate,
  authorizeUser,
  async (req, res) => {
    const requestedAmount = Number(req.body.amount);
    const explicitUserId = req.body.userId;
    const userId = Number(explicitUserId ?? req.user.id);
    const orderId =
      (req.body.orderId && String(req.body.orderId).trim()) ||
      crypto.randomUUID();
    const redirectAfterSuccessRaw = req.body.redirectAfterSuccess;
    const redirectAfterSuccess =
      typeof redirectAfterSuccessRaw === "string" &&
      redirectAfterSuccessRaw.startsWith("/")
        ? redirectAfterSuccessRaw
        : "/wallet";

    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({ error: "Enter a valid amount in NPR." });
    }
    if (userId !== Number(req.user.id)) {
      return res
        .status(403)
        .json({ error: "You can only initiate payment for yourself." });
    }

    const amountNpr = roundMoney(requestedAmount);
    if (amountNpr < MIN_TOPUP_NPR) {
      return res
        .status(400)
        .json({
          error: `Minimum top-up is NPR ${MIN_TOPUP_NPR.toLocaleString()}.`,
        });
    }
    if (amountNpr > MAX_TOPUP_NPR) {
      return res
        .status(400)
        .json({
          error: `Maximum single top-up is NPR ${MAX_TOPUP_NPR.toLocaleString()}.`,
        });
    }

    const amountPaisa = Math.round(amountNpr * 100);
    const siteUrl = getSiteUrl();
    const returnUrl = `${siteUrl}/payment/callback?redirect=${encodeURIComponent(redirectAfterSuccess)}`;

    try {
      const userRow = await pool.query(
        "SELECT id, name, email, phone FROM users WHERE id = $1",
        [userId],
      );
      if (userRow.rows.length === 0) {
        return res.status(404).json({ error: "User not found." });
      }
      const user = userRow.rows[0];

      const khaltiPayload = {
        return_url: returnUrl,
        website_url: siteUrl,
        amount: amountPaisa,
        purchase_order_id: orderId,
        purchase_order_name: "Wallet Top-up",
        customer_info: {
          name: user.name,
          email: user.email,
          phone: user.phone || "",
        },
      };

      const kh = await khaltiPost("/epayment/initiate/", khaltiPayload);
      if (!kh.pidx || !kh.payment_url) {
        return res
          .status(502)
          .json({ error: "Invalid response from Khalti initiate API." });
      }

      await pool.query(
        `INSERT INTO khalti_transactions
        (pidx, purchase_order_id, user_id, amount_npr, amount_paisa, status)
       VALUES ($1, $2, $3, $4, $5, 'initiated')
       ON CONFLICT (pidx) DO UPDATE
       SET purchase_order_id = EXCLUDED.purchase_order_id,
           user_id = EXCLUDED.user_id,
           amount_npr = EXCLUDED.amount_npr,
           amount_paisa = EXCLUDED.amount_paisa,
           status = 'initiated',
           updated_at = NOW()`,
        [kh.pidx, orderId, userId, amountNpr, amountPaisa],
      );

      return res.status(201).json({
        payment_url: kh.payment_url,
        pidx: kh.pidx,
        orderId,
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  },
);

router.get("/khalti/callback", async (req, res) => {
  const { pidx } = req.query;
  if (!pidx) {
    return res.status(400).json({ error: "Missing pidx query parameter." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txRes = await client.query(
      "SELECT * FROM khalti_transactions WHERE pidx = $1 FOR UPDATE",
      [String(pidx)],
    );
    if (txRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "Transaction not found for provided pidx." });
    }
    const tx = txRes.rows[0];

    const lookup = await khaltiPost("/epayment/lookup/", {
      pidx: String(pidx),
    });
    const normalizedStatus = mapKhaltiStatus(lookup.status);

    if (normalizedStatus === "completed" && tx.status === "completed") {
      const balRes = await client.query(
        "SELECT wallet_balance FROM users WHERE id = $1",
        [tx.user_id],
      );
      await client.query("COMMIT");
      return res.json({
        status: "completed",
        message: "Payment already verified and wallet already credited.",
        credited_npr: Number(tx.amount_npr),
        total_balance_npr: balRes.rows.length
          ? Number(balRes.rows[0].wallet_balance)
          : null,
      });
    }

    await client.query(
      `UPDATE khalti_transactions
       SET status = $1,
           transaction_id = COALESCE($2, transaction_id),
           updated_at = NOW()
       WHERE pidx = $3`,
      [normalizedStatus, lookup.transaction_id || null, String(pidx)],
    );

    if (normalizedStatus === "completed") {
      const amountNpr = Number(tx.amount_npr);
      const { balance_after } = await applyWalletChange(client, {
        userId: tx.user_id,
        delta: amountNpr,
        type: "top_up",
        referenceId: null,
        description: `Khalti top-up NPR ${amountNpr.toLocaleString()} (PIDX ${tx.pidx})`,
      });
      await client.query("COMMIT");

      const creditedDisplay = amountNpr.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      });
      try {
        await createNotification(pool, {
          userId: tx.user_id,
          type: "wallet_khalti",
          title: "Wallet credited (Khalti)",
          message: `NPR ${creditedDisplay} was added to your wallet via Khalti.`,
          relatedBookingId: null,
        });

        const userRes = await pool.query(
          "SELECT name, email FROM users WHERE id = $1",
          [tx.user_id],
        );
        const user = userRes.rows[0] || {};
        const mail = walletTopUp({
          passengerName: user.name,
          amount: amountNpr,
          method: "Khalti",
        });
        sendEmail(user.email, mail.subject, mail.html).catch((e) =>
          console.error("wallet khalti email failed:", e.message),
        );
      } catch (notifyErr) {
        console.error("createNotification (wallet_khalti):", notifyErr.message);
      }

      return res.json({
        status: "completed",
        message: "Payment verified and wallet credited.",
        credited_npr: amountNpr,
        total_balance_npr: Number(balance_after),
      });
    }

    await client.query("COMMIT");
    if (normalizedStatus === "pending") {
      return res.json({
        status: "pending",
        message: "Payment is pending confirmation.",
      });
    }

    return res.json({
      status: normalizedStatus,
      message:
        "Payment failed, expired, or cancelled. Wallet was not credited.",
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
