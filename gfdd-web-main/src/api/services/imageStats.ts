import { API_BASE_URL, getAuthHeaders } from "../client"
import { ENDPOINTS } from "../endpoints"
import { PixelStatisticsParams } from "../../types/apiTypes"

export async function fetchImageStats(
  files: File[],
  params: PixelStatisticsParams
): Promise<any> {
  const formData = new FormData()
  files.forEach((v) => {
    formData.append("files", v)
  })
  formData.append("mode", params.mode)
  formData.append("contrast", params.contrast.toString())
  formData.append("grayscale", params.grayscale.toString())
  formData.append("radius", params.radius.toString())
  formData.append("anti_forensics", params.anti_forensics.toString())
  formData.append("inclusive", params.inclusive.toString())

  try {
    const response = await fetch(
      `${API_BASE_URL}${ENDPOINTS.COMBINED_ANALYSIS}`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        errorData.message || `Failed to fetch image stats: ${response.status}`
      )
    }
    const data = await response.json()
    return data
  } catch (error) {
    console.error("Error fetching image stats:", error)
    throw new Error(
      error instanceof Error ? error.message : "Failed to process image stats"
    )
  }
}

export async function fetchAsyncImageStats(
  files: File[],
  inclusive: Boolean
): Promise<any> {
  const formData = new FormData()
  files.forEach((v) => {
    formData.append("files", v)
  })
  formData.append("mode", "Distance")
  formData.append("contrast", "85")
  formData.append("grayscale", "false")
  formData.append("radius", "2")
  formData.append("anti_forensics", "false")
  formData.append("inclusive", inclusive.toString())

  try {
    const response = await fetch(
      `${API_BASE_URL}${ENDPOINTS.ASYNC_COMBINED_ANALYSIS}`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        errorData.message || `Failed to fetch image stats: ${response.status}`
      )
    }
    const data = await response.json()
    return data
  } catch (error) {
    console.error("Error fetching image stats:", error)
    throw new Error(
      error instanceof Error ? error.message : "Failed to process image stats"
    )
  }
}


