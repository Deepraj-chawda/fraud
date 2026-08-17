import { API_BASE_URL, getAuthHeaders } from "../client";
import { ENDPOINTS } from "../endpoints";
import { ImageStatsResponse } from "../../types/apiTypes";

export async function fetchImageStats(
  image: File,
  mode: string,
  inclusive: boolean,
): Promise<ImageStatsResponse> {
  const formData = new FormData();
  formData.append("image", image);
  formData.append("mode", mode);
  formData.append("inclusive", inclusive.toString());
  try {
    const response = await fetch(`${API_BASE_URL}${ENDPOINTS.IMAGE_STATISTICS}`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to fetch image stats: ${response.status}`);
    }

    const data = await response.json();
    
    const imageUrl = `data:image/${data.filename.split('.').pop()};base64,${data.image}`;

    return {
      imageUrl,
      filename: data.filename,
      stats: {
        blue: data.stats.blue,
        green: data.stats.green,
        red: data.stats.red,
      },
      mode: data.mode,
      inclusive: data.inclusive,
    };
  } catch (error) {
    console.error("Error fetching image stats:", error);
    throw new Error(error instanceof Error ? error.message : "Failed to process image stats");
  }
}