import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { auth as authAPI } from "../api";
import cloudsBg from "../assets/clouds-bg.png";
import "./AuthPage.css";

function normalizePhone(value) {
  return String(value || "")
    .replace(/[\s-]/g, "")
    .trim();
}

function isValidPhone(value) {
  const phone = normalizePhone(value);
  if (!phone) return true;
  return /^\d{10}$/.test(phone);
}

function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from || "/flights";
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [forgotOtpSent, setForgotOtpSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otp, setOtp] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [forgot, setForgot] = useState({
    email: "",
    otp: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!isLogin && !isValidPhone(form.phone)) {
      setError("Enter a valid 10-digit phone number.");
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        await login(form.email, form.password);
        navigate(redirectTo, { replace: true });
        return;
      }

      const result = await register(
        form.name,
        form.email,
        form.password,
        form.phone,
      );

      if (result?.verificationRequired === false) {
        await login(form.email, form.password);
        navigate(redirectTo, { replace: true });
        return;
      }

      setVerificationEmail(form.email);
      setOtp("");
      setVerifying(true);
      setError("An OTP has been sent to your email address.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestResetOtp = async (e) => {
    e.preventDefault();
    setError("");
    setOtpLoading(true);
    try {
      await authAPI.requestPasswordResetOtp({ email: forgot.email });
      setForgotOtpSent(true);
      setError("If this email exists, a reset code has been sent.");
    } catch (err) {
      setError(err.message);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError("");
    if (forgot.newPassword !== forgot.confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setOtpLoading(true);
    try {
      await authAPI.resetPasswordWithOtp({
        email: forgot.email,
        otp: forgot.otp,
        newPassword: forgot.newPassword,
      });
      setForgotPasswordMode(false);
      setForgotOtpSent(false);
      setIsLogin(true);
      setForm((prev) => ({
        ...prev,
        email: forgot.email,
        password: "",
      }));
      setForgot({
        email: "",
        otp: "",
        newPassword: "",
        confirmPassword: "",
      });
      setError("Password reset successful. Please sign in.");
    } catch (err) {
      setError(err.message);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError("");
    setOtpLoading(true);
    try {
      await authAPI.verifyOtp({ email: verificationEmail, otp });
      await login(verificationEmail, form.password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setError("");
    setOtpLoading(true);
    try {
      await authAPI.sendOtp({ email: verificationEmail });
      setError("OTP resent to your email.");
    } catch (err) {
      setError(err.message);
    } finally {
      setOtpLoading(false);
    }
  };

  return (
    <div className="auth-page" style={{ backgroundImage: `url(${cloudsBg})` }}>
      <div className="auth-card">
        <h1 className="auth-logo" onClick={() => navigate("/")}>
          Binayak Airlines
        </h1>

        <p className="auth-subtitle">
          {forgotPasswordMode
            ? forgotOtpSent
              ? "Enter the reset code and set a new password"
              : "Enter your email to receive a reset code"
            : verifying
              ? "Enter the OTP sent to your email"
              : isLogin
                ? "Sign in to your account"
                : "Create a new account"}
        </p>

        {error && <div className="auth-error">{error}</div>}

        {forgotPasswordMode ? (
          !forgotOtpSent ? (
            <form onSubmit={handleRequestResetOtp} className="auth-form">
              <div className="auth-field">
                <label>Email</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={forgot.email}
                  onChange={(e) =>
                    setForgot({ ...forgot, email: e.target.value })
                  }
                  required
                />
              </div>
              <button
                type="submit"
                className="auth-submit"
                disabled={otpLoading}
              >
                {otpLoading ? "Please wait..." : "Send Reset Code"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="auth-form">
              <div className="auth-field">
                <label>Email</label>
                <input type="email" value={forgot.email} disabled readOnly />
              </div>
              <div className="auth-field">
                <label>Reset Code</label>
                <input
                  type="text"
                  placeholder="6-digit code"
                  value={forgot.otp}
                  onChange={(e) =>
                    setForgot({
                      ...forgot,
                      otp: e.target.value.replace(/\D/g, ""),
                    })
                  }
                  required
                  maxLength={6}
                  inputMode="numeric"
                />
              </div>
              <div className="auth-field">
                <label>New Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={forgot.newPassword}
                  onChange={(e) =>
                    setForgot({ ...forgot, newPassword: e.target.value })
                  }
                  required
                  minLength={6}
                />
              </div>
              <div className="auth-field">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={forgot.confirmPassword}
                  onChange={(e) =>
                    setForgot({ ...forgot, confirmPassword: e.target.value })
                  }
                  required
                  minLength={6}
                />
              </div>
              <button
                type="submit"
                className="auth-submit"
                disabled={otpLoading}
              >
                {otpLoading ? "Resetting..." : "Reset Password"}
              </button>
            </form>
          )
        ) : !verifying ? (
          <form onSubmit={handleSubmit} className="auth-form">
            {!isLogin && (
              <div className="auth-field">
                <label>Full Name</label>
                <input
                  type="text"
                  placeholder="elon musk"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
            )}

            <div className="auth-field">
              <label>Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>

            <div className="auth-field">
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={6}
              />
            </div>
            {isLogin ? (
              <div className="auth-inline-actions">
                <button
                  type="button"
                  className="auth-inline-link"
                  onClick={() => {
                    setForgotPasswordMode(true);
                    setForgotOtpSent(false);
                    setForgot({
                      email: form.email,
                      otp: "",
                      newPassword: "",
                      confirmPassword: "",
                    });
                    setError("");
                  }}
                >
                  Forgot password?
                </button>
              </div>
            ) : null}

            {!isLogin && (
              <div className="auth-field">
                <label>Phone</label>
                <div className="auth-phone-field">
                  <span className="auth-phone-prefix">+977</span>
                  <input
                    type="tel"
                    placeholder="98XXXXXXXX"
                    value={form.phone}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        phone: normalizePhone(e.target.value),
                      })
                    }
                    pattern="^\d{10}$"
                    inputMode="numeric"
                    maxLength={10}
                    title="Enter exactly 10 digits"
                  />
                </div>
              </div>
            )}

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading
                ? "Please wait..."
                : isLogin
                  ? "Sign In"
                  : "Create Account"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="auth-form">
            <div className="auth-field">
              <label>Email</label>
              <input type="email" value={verificationEmail} disabled readOnly />
            </div>

            <div className="auth-field">
              <label>Verification Code</label>
              <input
                type="text"
                placeholder="6-digit code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                required
                maxLength={6}
                inputMode="numeric"
              />
            </div>

            <button type="submit" className="auth-submit" disabled={otpLoading}>
              {otpLoading ? "Verifying..." : "Verify Email"}
            </button>

            <button
              type="button"
              className="auth-submit auth-submit-secondary"
              onClick={handleResendOtp}
              disabled={otpLoading}
            >
              {otpLoading ? "Please wait..." : "Resend OTP"}
            </button>
          </form>
        )}

        <p className="auth-switch">
          {forgotPasswordMode ? (
            <button
              type="button"
              className="auth-switch-link"
              onClick={() => {
                setForgotPasswordMode(false);
                setForgotOtpSent(false);
                setError("");
              }}
            >
              Back to sign in
            </button>
          ) : verifying ? (
            <button
              type="button"
              className="auth-switch-link"
              onClick={() => {
                setVerifying(false);
                setError("");
              }}
            >
              Back to signup
            </button>
          ) : (
            <>
              {isLogin ? "Don't have an account?" : "Already have an account?"}
              <button
                type="button"
                className="auth-switch-link"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setError("");
                }}
              >
                {isLogin ? "Sign Up" : "Sign In"}
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export default AuthPage;
