import axios from "axios";
import { API_URL } from "../api";

const api = axios.create({
  baseURL: `${API_URL}/user`,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const getDashboardStats = async () => (await api.get("/dashboard-stats")).data;
export const getDashboardAnalytics = async (params) =>
  (await api.get("/dashboard-analytics", { params })).data;

export const getRecommendations = async () => {
  const token = localStorage.getItem("token");
  const { data } = await axios.get(`${API_URL}/recommendations`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return data;
};
export const getUserBookings = async () => (await api.get("/bookings")).data;
export const cancelUserBooking = async (id) => (await api.put(`/cancel-booking/${id}`)).data;
export const getWallet = async () => (await api.get("/wallet")).data;
export const getTransactions = async () => (await api.get("/transactions")).data;
export const changePassword = async (body) => (await api.put("/change-password", body)).data;
