import { API_BASE_URL, getAuthHeaders } from "../client";
import { AIDetectionResponse, MultiAIDetectionResponse } from "../../types/apiTypes";
import { ENDPOINTS } from "../endpoints";

export const detectAISingle = async (file: File): Promise<AIDetectionResponse> => {
  const formData = new FormData();
  formData.append("image", file);
  const response = await fetch(`${API_BASE_URL}${ENDPOINTS.DETECT_AI_SINGLE}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to detect AI content");
  }

  return response.json();
};

export const detectAIImages = async (files: File[]): Promise<MultiAIDetectionResponse> => {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  const response = await fetch(`${API_BASE_URL}${ENDPOINTS.DETECT_AI_IMAGES}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Failed to detect AI images");
  }

  return response.json();
};
