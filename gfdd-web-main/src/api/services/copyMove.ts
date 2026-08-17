import { API_BASE_URL, getAuthHeaders } from "../client";
import { ENDPOINTS } from "../endpoints";

export async function fetchCopyMoveDetection(
  files: File[],
  params: {
    detector: string;
    response_threshold: number;
    matching_threshold: number;
    distance_threshold: number;
    cluster_size: number;
    show_keypoints?: boolean;
    hide_lines: boolean;
    use_mask: boolean;
    mask?: File;
  },
  toast: (options: { title: string; description: string }) => void // Add toast as a parameter
): Promise<any> {
  const formData = new FormData();
  files.forEach(file=>{
    formData.append("files", file);
  })
  formData.append("detector", params.detector);
  formData.append("response_threshold", params.response_threshold.toString());
  formData.append("matching_threshold", params.matching_threshold.toString());
  formData.append("distance_threshold", params.distance_threshold.toString());
  formData.append("cluster_size", params.cluster_size.toString());
  formData.append("hide_lines", params.hide_lines.toString());
  formData.append("use_mask", params.use_mask.toString());
  if (params.show_keypoints !== undefined) {
    formData.append("show_keypoints", params.show_keypoints.toString());
  }
  if (params.use_mask && params.mask) {
    formData.append("mask", params.mask);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${ENDPOINTS.DETECT_COPY_MOVE}`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || `Failed to fetch copy-move detection: ${response.status}`;
      toast({
        title: "Analysis Failed",
        description: errorMessage,
      });
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    // Convert base64 result_image to data URL (assume PNG based on input example)
    const imageUrl = `data:image/png;base64,${data.result_image}`;

    toast({
      title: "Analysis Complete",
      description: "Image analyzed successfully",
    });

    return data
  } catch (error) {
    console.error("Error fetching copy-move detection:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to process copy-move detection";
    toast({
      title: "Analysis Failed",
      description: errorMessage,
    });
    throw new Error(errorMessage);
  }
}