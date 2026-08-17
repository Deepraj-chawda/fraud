const API_BASE_URL = import.meta.env.VITE_BASE_URL || "/api";
export const getAuthToken = (): string | null => localStorage.getItem("access_token") || null;

export const getAuthHeaders = (): HeadersInit => {
  const token = getAuthToken();
  return {
    Authorization: token ? `Bearer ${token}` : "",
    Accept: "application/json",
  };
};

export { API_BASE_URL };
