import { API_BASE_URL, getAuthHeaders } from "../client"
import { ENDPOINTS } from "../endpoints"

export const getAllModulesApi = async (): Promise<any> => {
  const response = await fetch(`${API_BASE_URL}${ENDPOINTS.GET_ALL_MODULES}`, {
    method: "get",
    headers: getAuthHeaders(),
  })

  if (!response.ok) {
    throw new Error("Failed to detect AI content")
  }

  return response.json()
}
export const getMassUploadModulesApi = async (): Promise<any> => {
  const response = await fetch(
    `${API_BASE_URL}${ENDPOINTS.GET_MASS_UPLOAD_MODULES}`,
    {
      method: "get",
      headers: getAuthHeaders(),
    }
  )

  if (!response.ok) {
    throw new Error("Failed to detect AI content")
  }

  return response.json()
}


/**
 * Fetches the detailed analysis results for a specific batch ID.
 */
export async function fetchBatchResults(batchId: string | number): Promise<any> {
  try {
    // Construct the URL for the new endpoint
    // Assuming ENDPOINTS.BATCH_RESULTS might be "/results/batch/"
    // If not, manual construction is safer:
    const url = `${API_BASE_URL}${ENDPOINTS.RESULT}${batchId}`

    const response = await fetch(url, {
      method: "GET",
      headers: getAuthHeaders(),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        errorData.detail || // FastAPI often uses "detail" for errors
          `Failed to fetch batch results: ${response.status}`
      )
    }
    const data = await response.json()
    console.log("Batch results data:", data)
    return data
  } catch (error) {
    console.error("Error fetching batch results:", error)
    throw new Error(
      error instanceof Error ? error.message : "Failed to process batch results"
    )
  }
}
