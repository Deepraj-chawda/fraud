/* eslint-disable @typescript-eslint/no-explicit-any */
import { API_BASE_URL, getAuthHeaders } from "../client";
import { ENDPOINTS } from "../endpoints";
import { parseMetadataResponse } from "../parsers/metadataParser";

export const uploadImageAndGetMetadata = async (file: File) => {
  const formData = new FormData();
  formData.append("image", file);

  const [exifResponse, headerResponse] = await Promise.all([
    fetch(`${API_BASE_URL}${ENDPOINTS.EXIF}`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: formData,
    }),
    fetch(`${API_BASE_URL}${ENDPOINTS.HEADER_STRUCTURE}`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: formData,
    }),
  ]);

  if (!exifResponse.ok || !headerResponse.ok) {
    if (exifResponse.status === 401 || headerResponse.status === 401) {
      throw new Error("Unauthorized: Please log in again");
    }
    throw new Error("Failed to fetch metadata");
  }

  const exifData = await exifResponse.json();
  const headerData = await headerResponse.text();

  return { exifData, headerData };
};