export interface AIDetectionResponse {
  filename: string
  result: "real" | "AI"
  human_probability: number
  ai_probability: number
  real_probability: number
  original_filename: string
  page: Number
}

export interface MultiAIDetectionResponse {
  images: AIDetectionResponse[]
  total_files: number
  human_count: number
  ai_count: number
  error_images: { filename: string; error: string }[]
}

export interface CompareImagesResponse {
  threshold: number
  total_matches: number
  matches: {
    input_file: string
    compare_file: string
    matched: boolean
    distance: number
    threshold: number
    result: number
  }[]
  errors: string[]
}

export interface ImageStatsResponse {
  imageUrl: string
  filename: string
  stats: { blue: number; green: number; red: number }
  mode: string
  inclusive: boolean
}

export interface CopyMoveDetectionResponse {
  total_keypoints: number
  filtered_keypoints: number
  matches: number
  clusters: number
  regions: number
  processing_time: number
  result_image: string
}

export interface LoginPayload {
  email: string
  password: string
}

// Define the processing modes
export type ProcessingMode = "Distance" | "Projection" | "Cross Product"
export interface PixelStatisticsParams {
  mode: ProcessingMode
  radius: number
  contrast: number
  grayscale: boolean
  anti_forensics: boolean
  inclusive: boolean
}

export interface OcrAnalysisParams {
  best_mode: boolean
  filename: string
  template_type: string
  oem: string
  psm: string | " "
  lang: string[]
}
