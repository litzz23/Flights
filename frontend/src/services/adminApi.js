import axios from "axios";
import { API_URL } from "../api";

const adminApi = axios.create({
  baseURL: `${API_URL}/admin`,
});

adminApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("adminToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const adminAuthApi = {
  login: async (body) =>
    (await axios.post(`${API_URL}/admin/auth/login`, body)).data,
};

export const adminStatsApi = {
  getStats: async () => (await adminApi.get("/stats")).data,
  getAnalytics: async (params) =>
    (await adminApi.get("/analytics", { params })).data,
};

export const adminAlertsApi = {
  getFlights: async () => (await adminApi.get("/alerts/flights")).data,
  broadcast: async (body) =>
    (await adminApi.post("/alerts/broadcast", body)).data,
};

export const adminFlightsApi = {
  getAll: async () => (await adminApi.get("/flights")).data,
  create: async (body) => (await adminApi.post("/flights", body)).data,
  update: async (id, body) => (await adminApi.put(`/flights/${id}`, body)).data,
  delete: async (id) => (await adminApi.delete(`/flights/${id}`)).data,
};

export const adminDestinationsApi = {
  getAll: async () => (await adminApi.get("/destinations")).data,
  create: async (body) => (await adminApi.post("/destinations", body)).data,
  update: async (id, body) =>
    (await adminApi.put(`/destinations/${id}`, body)).data,
  delete: async (id) => (await adminApi.delete(`/destinations/${id}`)).data,
};

export const adminBookingsApi = {
  getAll: async () => (await adminApi.get("/bookings")).data,
  updateStatus: async (id, status) =>
    (await adminApi.put(`/bookings/${id}`, { status })).data,
};

export const adminUsersApi = {
  getAll: async () => (await adminApi.get("/users")).data,
  updateStatus: async (id, is_active) =>
    (await adminApi.put(`/users/${id}/status`, { is_active })).data,
};
