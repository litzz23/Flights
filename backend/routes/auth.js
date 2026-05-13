const router = require("express").Router();
const pool = require("../db/pool");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { authenticate } = require("../middleware/auth");
const { getTransporter } = require("../utils/sendEmail");

function normalizePhone(value) {
  return String(value || "")
    .replace(/[\s-]/g, "")
    .trim();
}

function isValidPhone(value) {
  const phone = normalizePhone(value);
  if (!phone) return true;
  return /^(?:\+977)?\d{10}$/.test(phone);
}

function formatSignupPhone(value) {
  const phone = normalizePhone(value);
  if (!phone) return null;
  if (/^\d{10}$/.test(phone)) {
    return `+977${phone}`;
  }
  if (/^\+977\d{10}$/.test(phone)) {
    return phone;
  }
  return phone;
}

function normalizeEmail(value) {
  return String(value || "").trim();
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function isEmailTransportMissingError(err) {
  const message = String(err?.message || "");
  return (
    message.includes("Email credentials are missing") ||
    message.includes("EMAIL_USER and EMAIL_PASS") ||
    message.includes("Missing credentials") ||
    message.includes("Invalid login") ||
    message.includes("timed out")
  );
}

async function ensureEmailOtpsTable(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS email_otps (
      id SERIAL PRIMARY KEY,
      email VARCHAR(150) NOT NULL,
      purpose VARCHAR(32) NOT NULL DEFAULT 'verification',
      otp_code VARCHAR(6) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT false
    )
  `);
  await client.query(`
    ALTER TABLE email_otps
    ADD COLUMN IF NOT EXISTS purpose VARCHAR(32) NOT NULL DEFAULT 'verification'
  `);
}

async function ensureUserEmailVerifiedColumn(client = pool) {
  await client.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true
  `);
}

async function ensureUserActiveColumn(client = pool) {
  await client.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
  `);
}

function buildOtpEmailHtml(otpCode, purpose = "verification") {
  const isReset = purpose === "password_reset";
  const heading = isReset ? "Reset your password" : "Verify your email address";
  const intro = isReset
    ? "Use the one-time passcode below to reset your account password. The code expires in 10 minutes."
    : "Use the one-time passcode below to complete your sign-in or verification request. The code expires in 10 minutes.";
  const otpLabel = isReset ? "Password reset code" : "Your OTP";
  const note = isReset
    ? "If you did not request a password reset, ignore this email and keep your account password unchanged."
    : "If you did not request this code, you can safely ignore this email. No changes will be made to your account unless the code is verified.";

  return `
    <div style="margin:0;padding:0;background:#08111f;font-family:Arial,Helvetica,sans-serif;color:#f5f7fb;">
      <div style="max-width:640px;margin:0 auto;padding:40px 20px;">
        <div style="background:linear-gradient(180deg,#0f1b2f 0%,#09101c 100%);border:1px solid rgba(255,255,255,0.08);border-radius:24px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.35);">
          <div style="padding:28px 32px;border-bottom:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
            <div style="font-size:12px;letter-spacing:0.24em;text-transform:uppercase;color:#93c5fd;margin-bottom:10px;">Binayak Airlines</div>
            <h1 style="margin:0;font-size:28px;line-height:1.2;color:#ffffff;">${heading}</h1>
            <p style="margin:12px 0 0;font-size:15px;line-height:1.7;color:#c7d2e5;">${intro}</p>
          </div>
          <div style="padding:32px;">
            <div style="background:linear-gradient(135deg,rgba(56,189,248,0.18),rgba(59,130,246,0.12));border:1px solid rgba(96,165,250,0.28);border-radius:20px;padding:28px;text-align:center;">
              <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#93c5fd;margin-bottom:12px;">${otpLabel}</div>
              <div style="font-size:44px;line-height:1;font-weight:800;letter-spacing:0.2em;color:#ffffff;margin:0;">${otpCode}</div>
            </div>
            <p style="margin:24px 0 0;font-size:14px;line-height:1.8;color:#c7d2e5;">${note}</p>
          </div>
          <div style="padding:0 32px 28px;color:#7f8ea8;font-size:12px;line-height:1.7;">
            <div style="height:1px;background:rgba(255,255,255,0.08);margin-bottom:18px;"></div>
            <p style="margin:0;">Binayak Airlines security team</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function issueEmailOtp(email, purpose = "verification") {
  await ensureEmailOtpsTable();

  const client = await pool.connect();
  const otpCode = generateOtpCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE email_otps SET used = true WHERE email = $1 AND purpose = $2 AND used = false",
      [email, purpose],
    );
    await client.query(
      "INSERT INTO email_otps (email, purpose, otp_code, expires_at, used) VALUES ($1, $2, $3, $4, false)",
      [email, purpose, otpCode, expiresAt],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const transporter = getTransporter();
  if (!transporter) {
    throw new Error(
      "Email credentials are missing. Set EMAIL_USER and EMAIL_PASS.",
    );
  }
  await Promise.race([
    transporter.sendMail({
      from: `"Binayak Airlines" <${process.env.EMAIL_USER}>`,
      to: email,
      subject:
        purpose === "password_reset"
          ? "Binayak Airlines password reset code"
          : purpose === "registration"
            ? "Your Binayak Airlines verification code"
            : "Binayak Airlines email verification code",
      text:
        purpose === "password_reset"
          ? `Your Binayak Airlines password reset code is ${otpCode}. It expires in 10 minutes.`
          : `Your Binayak Airlines verification code is ${otpCode}. It expires in 10 minutes.`,
      html: buildOtpEmailHtml(otpCode, purpose),
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Email sending timed out.")), 15000);
    }),
  ]);

  return otpCode;
}

router.post("/send-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    await issueEmailOtp(email, "verification");

    res.json({ message: "OTP sent successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();

    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required." });
    }

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: "Enter a valid 6-digit OTP." });
    }

    await ensureUserEmailVerifiedColumn();
    await ensureEmailOtpsTable();

    const otpResult = await pool.query(
      `SELECT id, expires_at, used
       FROM email_otps
       WHERE email = $1
         AND otp_code = $2
         AND purpose IN ('verification', 'registration')
       ORDER BY id DESC
       LIMIT 1`,
      [email, otp],
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid OTP." });
    }

    const otpRow = otpResult.rows[0];
    if (otpRow.used) {
      return res.status(400).json({ error: "This OTP has already been used." });
    }

    if (new Date(otpRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "OTP has expired." });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    await pool.query("UPDATE email_otps SET used = true WHERE id = $1", [
      otpRow.id,
    ]);
    await pool.query(
      "UPDATE users SET email_verified = true WHERE email = $1",
      [email],
    );

    res.json({ message: "Email verified successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/forgot-password/request-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (userResult.rows.length === 0) {
      return res.json({
        message: "If this email exists, a password reset code has been sent.",
      });
    }

    await issueEmailOtp(email, "password_reset");

    res.json({
      message: "If this email exists, a password reset code has been sent.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/forgot-password/reset", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!email || !otp || !newPassword) {
      return res
        .status(400)
        .json({ error: "Email, OTP and new password are required." });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: "Enter a valid 6-digit OTP." });
    }
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters." });
    }

    await ensureEmailOtpsTable();

    const otpResult = await pool.query(
      `SELECT id, expires_at, used
       FROM email_otps
       WHERE email = $1
         AND otp_code = $2
         AND purpose = 'password_reset'
       ORDER BY id DESC
       LIMIT 1`,
      [email, otp],
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid OTP." });
    }

    const otpRow = otpResult.rows[0];
    if (otpRow.used) {
      return res.status(400).json({ error: "This OTP has already been used." });
    }
    if (new Date(otpRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "OTP has expired." });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await pool.query("UPDATE email_otps SET used = true WHERE id = $1", [
      otpRow.id,
    ]);
    await pool.query("UPDATE users SET password = $1 WHERE email = $2", [
      hashedPassword,
      email,
    ]);

    res.json({ message: "Password reset successful. You can now sign in." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/register", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "");
  const phone = req.body.phone;
  const rawPhone = normalizePhone(phone);
  const normalizedPhone = formatSignupPhone(rawPhone);
  let createdUser = null;

  try {
    await ensureUserEmailVerifiedColumn();

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "Name, email and password are required." });
    }

    if (!isValidPhone(rawPhone)) {
      return res.status(400).json({
        error: "Enter a valid 10-digit phone number.",
      });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [
      email,
    ]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "INSERT INTO users (name, email, password, phone, email_verified) VALUES ($1, $2, $3, $4, false) RETURNING id, name, email, phone, role, created_at, wallet_balance, email_verified",
        [name, email, hashedPassword, normalizedPhone || null],
      );
      createdUser = result.rows[0];
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    try {
      await issueEmailOtp(email, "registration");
    } catch (mailErr) {
      if (!isEmailTransportMissingError(mailErr)) {
        await pool.query("DELETE FROM email_otps WHERE email = $1", [email]);
        if (createdUser?.id) {
          await pool.query("DELETE FROM users WHERE id = $1", [createdUser.id]);
        }
        throw mailErr;
      }

      await pool.query(
        "UPDATE users SET email_verified = true WHERE email = $1",
        [email],
      );

      return res.status(201).json({
        message:
          "Account created. Email verification is unavailable right now, so your account is ready to use.",
        email,
        verificationRequired: false,
      });
    }

    res.status(201).json({
      message:
        "Account created. Check your email for the OTP to verify your account.",
      email,
      verificationRequired: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    await ensureUserActiveColumn();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email and password are required." });
    }

    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = result.rows[0];
    if (user.role === "admin") {
      return res
        .status(403)
        .json({ error: "Use admin login for admin account access." });
    }
    if (user.is_active === false) {
      return res
        .status(403)
        .json({ error: "This account has been deactivated." });
    }
    if (user.email_verified === false) {
      await pool.query("UPDATE users SET email_verified = true WHERE id = $1", [
        user.id,
      ]);
      user.email_verified = true;
    }
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/me", authenticate, async (req, res) => {
  try {
    await ensureUserEmailVerifiedColumn();
    await ensureUserActiveColumn();
    const result = await pool.query(
      "SELECT id, name, email, phone, role, created_at, wallet_balance, email_verified, is_active FROM users WHERE id = $1",
      [req.user.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
