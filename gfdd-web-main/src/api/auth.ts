import { getAuthToken } from "./client";
import { API_BASE_URL, getAuthHeaders } from "./client";
import { ENDPOINTS } from "./endpoints";
import {LoginPayload} from "../types/apiTypes"

export const isAuthenticated = (): boolean => !!getAuthToken();

export async function loginUser({ email, password }: LoginPayload) {
  const response = await fetch(`${API_BASE_URL}${ENDPOINTS.LOGIN}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Login failed: ${response.statusText} (${errorText})`);
  }

  const data = await response.json();
  return data;
}
