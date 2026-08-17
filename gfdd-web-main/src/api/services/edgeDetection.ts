import { API_BASE_URL, getAuthHeaders } from "../client";
import { ENDPOINTS } from "../endpoints";

export interface EdgeDetectionResponse {
  imageUrl: string;
  processing_time: number;
  image_size: {
    width: number;
    height: number;
  };
  parameters: {
    radius: number;
    contrast: number;
    grayscale: boolean;
  };
}

export async function fetchEdgeDetection(
  files: File[],
  radius: number,
  contrast: number,
  grayscale: boolean,
  anti_forensics: boolean
): Promise<any> {
  const formData = new FormData();
  files.forEach(file=>{
    formData.append("files", file);
  })
  formData.append("radius", radius.toString());
  formData.append("contrast", contrast.toString());
  formData.append("grayscale", grayscale.toString());
  formData.append("anti_forensics", anti_forensics.toString());

  try {
    const response = await fetch(`${API_BASE_URL}${ENDPOINTS.EDGE_FILTER}`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to fetch edge detection: ${response.status}`);
    }

    const data = await response.json();

    return data
  } catch (error) {
    console.error("Error fetching edge detection:", error);
    throw new Error(error instanceof Error ? error.message : "Failed to process edge detection");
  }
}