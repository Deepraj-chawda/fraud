import React, { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Upload,
  CheckCircle,
  AlertTriangle,
  Loader,
  Image as ImageIcon,
  Folder,
  File,
  Download,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import EmptyState from "@/components/EmptyState"
import { useToast } from "@/hooks/use-toast"
import { detectAISingle, detectAIImages } from "@/api/services/aiDetection"
import { isAuthenticated } from "@/api/auth"
import { useNavigate } from "react-router-dom"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getDocument } from "pdfjs-dist"
import ImageViewer from "../components/copy-move-forgery/ImageViewer"
import { validateFileImagePdf } from "@/lib/utils"

type UploadMode = "single" | "multiple"
type DetectionResult = "AI" | "real" | "pending" | null

interface ProcessedFile {
  id: string
  file: File
  url: string
  result: DetectionResult
  humanProbability?: number
  aiProbability?: number
  page?: number
}
interface ImagePreView {
  imageUrl: string
  filename: string
  fileType: string
  pageNum: number
  fileSize: number
  lastFlag: boolean
  file: File
}

const AIDetection: React.FC = () => {
  const [uploadMode, setUploadMode] = useState<UploadMode>("single")
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingProgress, setProcessingProgress] = useState(0)
  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([])
  const [originFiles, setOriginFiles] = useState<File[]>([])
  const [showUploadModal, setShowUploadModal] = useState(false)
  const { toast } = useToast()
  const navigate = useNavigate()

  // Reset processed files when upload mode changes
  useEffect(() => {
    if (!isAuthenticated()) {
      toast({
        // title: "Authentication required",
        description: "Please log in to access this page",
        variant: "destructive",
      })
      navigate("/login")
    }
    setProcessedFiles([])
  }, [uploadMode])

  // useEffect(() => {
  //     if (!isAuthenticated()) {
  //       toast({
  //         title: "Authentication required",
  //         description: "Please log in to access this page",
  //         variant: "destructive",
  //       });
  //       navigate("/login");
  //     }
  //   }, [navigate, toast]);

  const processFiles = async () => {
    const totalFiles = processedFiles.length
    // Multiple image processing
    try {
      // Simulate progress animation
      let progress = 0
      const progressInterval = setInterval(() => {
        progress = Math.min(progress + 10, 80)
        setProcessingProgress(progress)
      }, 10)
      setIsProcessing(true)
      const apiResponse = await detectAIImages(originFiles)
      clearInterval(progressInterval)
      setProcessingProgress(100)
      // Map API results to processed files
      const updatedFiles = processedFiles.map((file) => {
        const detection = apiResponse.images.find(
          (res) =>
            res.filename === file.file.name ||
            (res.original_filename == file.file.name && res.page === file.page)
        )
        const error = apiResponse.error_images.find(
          (err) => err.filename === file.file.name
        )
        if (error) {
          return {
            ...file,
            result: null,
            humanProbability: 0,
            aiProbability: 0,
          }
        }
        return {
          ...file,
          result: detection?.result || null,
          humanProbability: detection
            ? Math.round(detection.real_probability * 100 * 100) / 100
            : 0,
          aiProbability: detection
            ? Math.round(detection.ai_probability * 100 * 100) / 100
            : 0,
        }
      })

      setProcessedFiles(updatedFiles)
      setCurrentFileIndex(totalFiles - 1) // Reflect all files processed

      // Show toasts for results and errors
      toast({
        title: "Analysis Complete",
        description: `Analyzed ${apiResponse.total_files} ${apiResponse.total_files === 1 ? "image" : "images"} successfully`,
      })

      if (apiResponse.error_images.length > 0) {
        toast({
          title: "Some images failed",
          description: `${apiResponse.error_images.length} image(s) could not be processed`,
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error processing files:", error)
      setProcessedFiles(
        processedFiles.map((file) => ({
          ...file,
          result: null,
          humanProbability: 0,
          aiProbability: 0,
        }))
      )
      toast({
        title: "Error",
        description: `Failed to analyze images: ${error instanceof Error ? error.message : "Unknown error"}`,
        variant: "destructive",
      })
    } finally {
      setIsProcessing(false)
      setProcessingProgress(100)
    }
    // }
  }

  const handleExportCSV = () => {
    // Filter files with valid results
    const validFiles = processedFiles.filter(
      (file) => file.result && file.result !== "pending"
    )

    if (validFiles.length === 0) {
      toast({
        title: "No Results to Export",
        description: "Please analyze images before exporting results",
        variant: "destructive",
      })
      return
    }

    // CSV header
    const headers = ["filename", "result", "real_probability", "ai_probability"]
    const csvRows = [headers.join(",")]

    // Add data rows
    validFiles.forEach((file) => {
      const filename = `"${file.file.name.replace(/"/g, '""')}"` // Escape quotes in filename
      const row = [
        filename,
        file.result || "N/A",
        // Convert percentages back to decimals for CSV
        file.humanProbability !== undefined
          ? (file.humanProbability / 100).toString()
          : "0",
        file.aiProbability !== undefined
          ? (file.aiProbability / 100).toString()
          : "0",
      ]
      csvRows.push(row.join(","))
    })

    // Create CSV content
    const csvContent = csvRows.join("\n")
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "ai_detection_results.csv"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    toast({
      title: "Export Successful",
      description: "Results have been exported as CSV",
    })
  }

  // Get filename without path for display
  const getFilenameWithoutPath = (filename: string) => {
    return filename.split("\\").pop()?.split("/").pop() || filename
  }

  const handleImageFileChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files
    if (!files.length) return
    const fileArray = Array.from(files)
    const res = validateFileImagePdf(fileArray)
    if (!res.flag) {
      toast({
        title: "Error",
        description: res.message,
      })
      return
    }
    setOriginFiles(fileArray)
    // Reset state for new uploads
    setProcessedFiles([])
    setProcessingProgress(0)
    setCurrentFileIndex(0)

    // 创建一个数组，用于存储每个文件的处理结果
    const filePromises = fileArray.map(async (file) => {
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = async (e) => {
          if (!e.target?.result) {
            resolve(null)
            return
          }
          if (file.type.startsWith("image/")) {
            resolve({
              imageUrl: e.target.result as string,
              filename: file.name,
              fileType: file.type,
              file,
              pageNum: 1,
              fileSize: file.size,
              lastFlag: true,
            })
          } else if (file.type === "application/pdf") {
            try {
              const fileURLs: ImagePreView[] = await handlePDFPreview(
                e.target.result as string,
                file
              )
              resolve(fileURLs)
            } catch (error) {
              console.error("Error processing PDF:", error)
              resolve(null)
            }
          }
        }
        reader.readAsDataURL(file)
      })
    })
    // 等待所有文件处理完成
    Promise.all(filePromises).then((processedFiles) => {
      const res = processedFiles.reduce<ImagePreView[]>((pre, v) => {
        return (pre = Array.isArray(v) ? [...pre, ...v] : [...pre, v])
      }, [])
      // Create initial processed files array with pending status
      const initialFiles = res.map((file, index) => ({
        id: `file-${Date.now()}-${index}`,
        file: file.file,
        url: file.imageUrl,
        page: file.pageNum,
        result: "pending" as DetectionResult,
      }))

      setProcessedFiles(initialFiles)
    })
    // Show toast notification
    toast({
      // title: `Analyzing ${selectedFiles.length} ${selectedFiles.length === 1 ? 'image' : 'images'}`,
      description: "Files uploaded successfully!",
    })
  }

  async function handlePDFPreview(result: string, file) {
    const pdf = await getDocument(result).promise
    const numPages = pdf.numPages
    let fileURLs: ImagePreView[] = []
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum)
        const viewport = page.getViewport({ scale: 1 })
        const canvas = document.createElement("canvas")
        canvas.width = viewport.width
        canvas.height = viewport.height
        const context = canvas.getContext("2d")
        if (!context) {
          throw new Error("Failed to get 2D context")
        }
        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        }
        await page.render(renderContext).promise
        const img = canvas.toDataURL("image/png")
        fileURLs.push({
          imageUrl: img,
          filename: file.name,
          fileType: file.type,
          pageNum: pageNum,
          file,
          lastFlag: pageNum === numPages,
          fileSize: file.size,
        })
        canvas.remove()
      } catch (error) {
        console.error("Error processing page:", error)
        continue
      }
    }
    return fileURLs
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white py-6">
      <div className="max-w-full mx-auto px-4 sm:px-4 lg:px-6">
        <Card className="mb-6 border-0 shadow-lg overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10 border-b border-slate-100 pb-3">
            <CardTitle className="text-xl flex items-center gap-2 text-slate-800">
              AI Integrity Check
            </CardTitle>
            <CardContent className="bg-white p-6 flex">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
                <div className="relative">
                  <Input
                    id="image-upload"
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    onChange={handleImageFileChange}
                    className="hidden"
                  />
                  <Label
                    htmlFor="image-upload"
                    className="flex items-center justify-center p-4 border-2 border-dashed border-slate-200 rounded-md bg-white hover:bg-slate-50 cursor-pointer transition-colors hover:border-primary/50"
                  >
                    <div className="text-center py-4">
                      <div className="mb-2 flex justify-center">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                          <svg
                            className="h-6 w-6 text-primary"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1.5}
                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                          </svg>
                        </div>
                      </div>
                      <p className="text-sm font-medium text-slate-800">
                        Click to upload an image/PDF
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        PNG, JPG, JPEG,PDF up to 10MB
                      </p>
                    </div>
                    {/* )} */}
                  </Label>
                </div>
                <div className="flex flex-col justify-end">
                  <Button
                    onClick={processFiles}
                    className="h-10 font-medium shadow-sm"
                    disabled={originFiles.length === 0}
                  >
                    {isProcessing ? (
                      <>
                        <Loader className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      "Process Image"
                    )}
                  </Button>
                  <Button
                    onClick={handleExportCSV}
                    variant="outline"
                    className="w-full sm:w-auto mt-3"
                    disabled={isProcessing || processedFiles.length === 0}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Export Results
                  </Button>
                </div>
              </div>
            </CardContent>
          </CardHeader>
        </Card>

        {/* Main Content - Image Analysis and Results */}
        {!originFiles || originFiles.length < 1 ? (
          <EmptyState
            icon="image"
            title="No Image Selected"
            description="Upload an image and configure parameters to detect copy-move forgery patterns for advanced forensic analysis."
            className="bg-white rounded-lg shadow-md"
            onUploadClick={() => {
              const input = document.getElementById("image-upload")
              if (input) {
                input.click()
              }
            }}
          />
        ) : (
          <div className="space-y-6">
            {/* Image Display Section */}
            <Card className="border-0 shadow-lg overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10 border-b border-slate-100 py-3">
                <CardTitle className="text-lg text-slate-800">
                  Image Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 bg-white">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-100">
                  <div className="relative bg-white">
                    <div className="py-2.5 px-4 border-b bg-slate-50 flex items-center justify-between">
                      <h3 className="font-medium text-slate-700 text-sm">
                        Original Image
                      </h3>
                      <span className="text-xs py-1 px-2 bg-slate-200 text-slate-600 rounded-full">
                        Source
                      </span>
                    </div>
                    <div className="p-0 relative">
                      {processedFiles &&
                        processedFiles.length > 0 &&
                        processedFiles.map((item, index) => (
                          <ImageViewer
                            className="h-[800px]"
                            key={index}
                            imageUrl={item.url}
                            altText="Original image"
                            type="original"
                          />
                        ))}
                    </div>
                  </div>

                  <div className="relative bg-white">
                    <div className="py-2.5 px-4 border-b bg-slate-50 flex items-center justify-between">
                      <h3 className="font-medium text-slate-700 text-sm">
                        Summary Results
                      </h3>
                      <span className="text-xs py-1 px-2 bg-blue-100 text-blue-600 rounded-full">
                        Results
                      </span>
                    </div>
                    <div className="p-0 h-[400px] relative">
                      {processedFiles &&
                      processedFiles[0]?.result === "pending" ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex flex-col items-center">
                            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                              <svg
                                className="h-8 w-8 text-slate-400"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth="1.5"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                            </div>
                            <p className="text-slate-600">
                              Run detection to see results
                            </p>
                          </div>
                        </div>
                      ) : (
                        processedFiles.map((item) => (
                          <div
                            className=" p-6 flex flex-col h-[800px]"
                            key={item.id}
                          >
                            <h3 className="text-xl font-semibold mb-4">
                              Analysis Result
                            </h3>

                            {item.result === "pending" ? (
                              <div className="flex items-center gap-3 mt-4">
                                <Loader className="h-6 w-6 animate-spin text-primary" />
                                <p>Analyzing image...</p>
                              </div>
                            ) : (
                              <div
                                className={`mt-2 p-6 rounded-lg ${
                                  item.result === "real"
                                    ? "bg-green-50 border border-green-200"
                                    : "bg-red-50 border border-red-200"
                                }`}
                              >
                                {item.result === "real" ? (
                                  <div className="flex items-center gap-3">
                                    <CheckCircle className="h-8 w-8 text-green-600" />
                                    <div>
                                      <p className="font-semibold text-lg text-green-600">
                                        This image is NOT AI-generated
                                      </p>
                                      <p className="text-sm text-green-700 mt-1">
                                        Real Probability:{" "}
                                        {item.humanProbability}%
                                      </p>
                                      <p className="text-sm text-green-700 mt-1">
                                        AI Probability: {item.aiProbability}%
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-3">
                                    <AlertTriangle className="h-8 w-8 text-red-600" />
                                    <div>
                                      <p className="font-semibold text-lg text-red-600">
                                        This image is AI-generated
                                      </p>
                                      <p className="text-sm text-red-700 mt-1">
                                        Real Probability:{" "}
                                        {item.humanProbability}%
                                      </p>
                                      <p className="text-sm text-red-700 mt-1">
                                        AI Probability: {item.aiProbability}%
                                      </p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="mt-8 space-y-4">
                              <h4 className="font-medium text-gray-800">
                                Image Details
                              </h4>
                              <div className="grid grid-cols-1 gap-2 text-sm">
                                <div className="flex justify-between py-2 px-4 bg-slate-50 rounded-md">
                                  <span className="text-gray-600">
                                    Filename:
                                  </span>
                                  <span className="font-medium">
                                    {getFilenameWithoutPath(item.file.name)}
                                  </span>
                                </div>
                                <div className="flex justify-between py-2 px-4 bg-slate-50 rounded-md">
                                  <span className="text-gray-600">
                                    File size:
                                  </span>
                                  <span className="font-medium">
                                    {Math.round(item.file.size / 1024)} KB
                                  </span>
                                </div>
                                <div className="flex justify-between py-2 px-4 bg-slate-50 rounded-md">
                                  <span className="text-gray-600">
                                    File type:
                                  </span>
                                  <span className="font-medium">
                                    {item.file.type}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

// Empty state component
// const EmptyStateView = ({ onUpload }: { onUpload: () => void }) => (
//   <div className="py-10 flex flex-col items-center text-center max-w-md mx-auto">
//     <div className="bg-slate-50 p-4 rounded-full mb-4">
//       <Folder className="h-10 w-10 text-slate-400" />
//     </div>
//     <h3 className="text-lg font-medium mt-2">No Images Selected</h3>
//     <p className="text-gray-500 my-3 text-sm">
//       Upload an image or a folder of images to analyze whether they're AI-generated or human-created.
//     </p>
//     <Button onClick={onUpload} className="mt-2">
//       <Upload className="mr-2 h-4 w-4" />
//       Upload Images
//     </Button>
//   </div>
// );

export default AIDetection
