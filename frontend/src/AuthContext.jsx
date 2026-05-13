import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { API_URL, auth as authAPI } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [adminUser, setAdminUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const token = localStorage.getItem("token");
      const adminToken = localStorage.getItem("adminToken");
      const jobs = [];

      if (token) {
        jobs.push(
          authAPI
            .me()
            .then(setUser)
            .catch(() => {
              localStorage.removeItem("token");
              setUser(null);
            }),
        );
      }

      if (adminToken) {
        jobs.push(
          fetch(`${API_URL}/admin/me`, {
            headers: { Authorization: `Bearer ${adminToken}` },
          })
            .then(async (res) => {
              const data = await res.json();
              if (!res.ok)
                throw new Error(data.error || "Failed to authenticate admin");
              return data;
            })
            .then(setAdminUser)
            .catch(() => {
              localStorage.removeItem("adminToken");
              setAdminUser(null);
            }),
        );
      }

      await Promise.all(jobs);
      setLoading(false);
    };

    load();
  }, []);

  const login = async (email, password) => {
    const data = await authAPI.login({ email, password });
    localStorage.setItem("token", data.token);
    setUser(data.user);
    return data;
  };

  const register = async (name, email, password, phone) => {
    const data = await authAPI.register({ name, email, password, phone });
    return data;
  };

  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };

  const adminLogin = async (email, password) => {
    const res = await fetch(`${API_URL}/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Admin login failed");
    localStorage.setItem("adminToken", data.token);
    setAdminUser(data.user);
    return data;
  };

  const adminLogout = () => {
    localStorage.removeItem("adminToken");
    setAdminUser(null);
  };

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const u = await authAPI.me();
      setUser(u);
    } catch {
      localStorage.removeItem("token");
      setUser(null);
    }
  }, []);

  const refreshAdminUser = useCallback(async () => {
    const token = localStorage.getItem("adminToken");
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/admin/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to refresh admin");
      setAdminUser(data);
    } catch {
      localStorage.removeItem("adminToken");
      setAdminUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        adminUser,
        loading,
        login,
        register,
        logout,
        adminLogin,
        adminLogout,
        refreshUser,
        refreshAdminUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
