export const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5001/api";

async function request(endpoint, options = {}) {
  const token = localStorage.getItem("token");
  const headers = { "Content-Type": "application/json", ...options.headers };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Something went wrong");
  }

  return data;
}

export const auth = {
  register: (body) =>
    request("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body) =>
    request("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  sendOtp: (body) =>
    request("/auth/send-otp", { method: "POST", body: JSON.stringify(body) }),
  verifyOtp: (body) =>
    request("/auth/verify-otp", { method: "POST", body: JSON.stringify(body) }),
  requestPasswordResetOtp: (body) =>
    request("/auth/forgot-password/request-otp", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  resetPasswordWithOtp: (body) =>
    request("/auth/forgot-password/reset", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  me: () => request("/auth/me"),
};

export const predictions = {
  getPrice: (flightId) => request(`/predictions/price/${flightId}`),
  getCancellationRisk: (flightId) =>
    request(`/predictions/cancellation-risk/${flightId}`),
  getRegionScores: () => request("/predictions/region-scores"),
  getMonthRisk: () => request("/predictions/month-risk"),
};

export const flights = {
  getAll: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/flights${query ? "?" + query : ""}`);
  },
  getDeals: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/flights/deals${q ? "?" + q : ""}`);
  },
  getMeta: () => request("/flights/meta"),
  getById: (id) => request(`/flights/${id}`),
  getSeats: (flightId) => request(`/flights/${flightId}/seats`),
};

export const notifications = {
  list: () => request("/notifications"),
  flightAlerts: () => request("/notifications/flight-alerts"),
  markRead: (id) => request(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllRead: () => request("/notifications/read-all", { method: "PATCH" }),
  delete: (id) => request(`/notifications/${id}`, { method: "DELETE" }),
};

export const bookings = {
  create: (body) =>
    request("/bookings", { method: "POST", body: JSON.stringify(body) }),
  getAll: () => request("/bookings"),
  getById: (id) => request(`/bookings/${id}`),
  getAlternatives: (id) => request(`/bookings/${id}/alternatives`),
  getCancellationPreview: (id) =>
    request(`/bookings/${id}/cancellation-preview`),
  getBoardingPass: (id) => request(`/bookings/${id}/boarding-pass`),
  cancel: (id) => request(`/bookings/${id}/cancel`, { method: "PATCH" }),
  confirmSeats: (bookingId, body) =>
    request(`/bookings/${bookingId}/confirm-seats`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export const seats = {
  lock: (seatIds) =>
    request("/seats/lock", {
      method: "POST",
      body: JSON.stringify({ seatIds }),
    }),
  swap: (body) =>
    request("/seats/swap", { method: "POST", body: JSON.stringify(body) }),
};

export const swapRequests = {
  create: (body) =>
    request("/swap-request", { method: "POST", body: JSON.stringify(body) }),
  list: () => request("/swap-requests"),
  accept: (id) => request(`/swap-request/${id}/accept`, { method: "POST" }),
  decline: (id) => request(`/swap-request/${id}/decline`, { method: "POST" }),
};

export const wallet = {
  get: () => request("/wallet"),
  addFunds: (amount) =>
    request("/wallet/add-funds", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
};

export const reviews = {
  list: () => request("/reviews"),
  create: (body) =>
    request("/reviews", { method: "POST", body: JSON.stringify(body) }),
};

export const payments = {
  khaltiInitiate: (body) =>
    request("/payments/khalti/initiate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  khaltiCallbackLookup: (queryString) =>
    request(`/payments/khalti/callback?${queryString}`),
};
