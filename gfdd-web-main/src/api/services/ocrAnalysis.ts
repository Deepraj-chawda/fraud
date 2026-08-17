import { API_BASE_URL, getAuthHeaders } from "../client";
import { ENDPOINTS } from "../endpoints";
import { OcrAnalysisParams } from "../../types/apiTypes";

export async function fetchOCRAnalysis(
  files: File[],
  params: OcrAnalysisParams,
): Promise<any> {
  const formData = new FormData();
  files.forEach((v)=>{
     formData.append("files", v)
  })
  formData.append("template_type", params.template_type);
  formData.append("oem", params.oem.toString());
  formData.append("psm", params.psm?.trim());
  formData.append("lang", params.lang.join('+'));
  formData.append("best_mode", params.best_mode.toString());
  
  try {
    const response = await fetch(`${API_BASE_URL}${ENDPOINTS.OCR_ANALYSIS}`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to fetch image stats: ${response.status}`);
    }
    const data = await response.json();
    return data
  } catch (error) {
    console.error("Error fetching image stats:", error);
    throw new Error(error instanceof Error ? error.message : "Failed to process image stats");
  }
}