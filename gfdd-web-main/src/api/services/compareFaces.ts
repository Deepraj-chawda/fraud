import { API_BASE_URL, getAuthHeaders } from "../client";
import { ENDPOINTS } from "../endpoints";
import { CompareImagesResponse } from "../../types/apiTypes";

export const compareImages = async (
  inputFiles: File[],
  compareFiles: File[],
  threshold: number
): Promise<CompareImagesResponse> => {
  const formData = new FormData();
  inputFiles.forEach((file) => formData.append("input_files", file));
  compareFiles.forEach((file) => formData.append("compare_files", file));
  formData.append("threshold", threshold.toString());

  const response = await fetch(`${API_BASE_URL}${ENDPOINTS.COMPARE_FACES}`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to compare faces: ${errorText}`);
  }

  return response.json();
};