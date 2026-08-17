import { API_BASE_URL, getAuthHeaders } from "../client";
import { ENDPOINTS } from "../endpoints";

export interface PcaAnalysisResponse {
  imageUrl: string;
  component: string;
  mode: string;
  invert: boolean;
  equalize: boolean;
  pca_data: {
    mean_vector: [number, number, number];
    eigenvectors: [[number, number, number], [number, number, number], [number, number, number]];
    eigenvalues: [number, number, number];
  };
}

export async function fetchPcaAnalysis(
  image: File,
  component: string,
  mode: string,
  invert: boolean,
  equalize: boolean
): Promise<PcaAnalysisResponse> {
  const formData = new FormData();
  formData.append("image", image);
  formData.append("component", component);
  formData.append("mode", mode);
  formData.append("invert", invert.toString());
  formData.append("equalize", equalize.toString());

  try {
    const response = await fetch(`${API_BASE_URL}${ENDPOINTS.PCA_ANALYSIS}`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to fetch PCA analysis: ${response.status}`);
    }

    const data = await response.json();

    const imageUrl = `data:image/png;base64,${data.result_image}`;

    return {
      imageUrl,
      component: data.component,
      mode: data.mode,
      invert: data.invert,
      equalize: data.equalize,
      pca_data: {
        mean_vector: data.pca_data.mean_vector,
        eigenvectors: data.pca_data.eigenvectors,
        eigenvalues: data.pca_data.eigenvalues,
      },
    };
  } catch (error) {
    console.error("Error fetching PCA analysis:", error);
    throw new Error(error instanceof Error ? error.message : "Failed to process PCA analysis");
  }
}