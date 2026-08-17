import React, { useEffect, useState } from "react"
import { getDocument } from "pdfjs-dist"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Label } from "@/components/ui/label"
import EmptyState from "@/components/EmptyState"
import { Loader, Info, Download, ChevronRight } from "lucide-react"
import ImageViewer from "../components/copy-move-forgery/ImageViewer"
import ParameterControl from "../components/copy-move-forgery/ParameterControl"
import { fetchCopyMoveDetection } from "@/api/services/copyMove"
import { isAuthenticated } from "@/api/auth"
import { useToast } from "@/hooks/use-toast"
import { useNavigate } from "react-router-dom"
import { validateFileImagePdf } from "@/lib/utils"

type DetectorType = "BRISK" | "ORB" | "AKAZE" | null

interface SummaryResult {
  label: string
  value: number
}
interface ForgeryScanResults {
  filename: string
  processedImageUrl: string
  dataList: SummaryResult[]
}

interface ImagePreView {
  imageUrl: string
  filename: string
  fileType: string
  pageNum: number
  fileSize: number
  lastFlag: boolean
}

const CopyMoveForgery: React.FC = () => {
  const [imageFile, setImageFile] = useState<File[] | null>(null)
  const [imagePreview, setImagePreview] = useState<string[] | null>(null)
  const [maskFile, setMaskFile] = useState<File[] | null>(null)
  const [maskPreview, setMaskPreview] = useState<string[] | null>(null)
  const [useMask, setUseMask] = useState<boolean>(false)
  const [detector, setDetector] = useState<DetectorType>(null)
  const [response, setResponse] = useState<number>(90)
  const [matching, setMatching] = useState<number>(20)
  const [distance, setDistance] = useState<number>(10)
  const [cluster, setCluster] = useState<number>(5)
  const [hideLines, setHideLines] = useState<boolean>(false)
  const [showKeypoints, setShowKeypoints] = useState<boolean>(true)
  const [results, setResults] = useState<ForgeryScanResults[] | null>(null)

  const { toast } = useToast()
  const navigate = useNavigate()
  useEffect(() => {
    if (!isAuthenticated()) {
      toast({
        // title: "Authentication required",
        description: "Please log in to access this page",
        variant: "destructive",
      })
      navigate("/login")
    }
  }, [navigate, toast])

  const { isLoading = false, refetch } = useQuery({
    queryKey: ["forgeryDetection"],
    queryFn: async () => {
      if (!imageFile || !detector) {
        // toast.error("Please upload an image and select a detector");
        toast({
          title: "Image and algorithm required",
          description: "Please upload an image and select a detector",
          variant: "destructive",
        })
        return null
      }
      if (useMask && !maskFile) {
        // toast.error("Please upload a mask image when mask is enabled");
        toast({
          title: "Mask image required",
          description: "Please upload a mask image when mask is enabled",
          variant: "destructive",
        })
        return null
      }

      try {
        const res = await fetchCopyMoveDetection(
          imageFile,
          {
            detector,
            response_threshold: response,
            matching_threshold: matching,
            distance_threshold: distance,
            cluster_size: cluster,
            show_keypoints: showKeypoints,
            hide_lines: hideLines,
            use_mask: useMask,
            // mask: maskFile,
          },
          toast
        )
        const mappedResult: ForgeryScanResults[] = []
        res.results.forEach((v) => {
          v.analysis.forEach((e, index) => {
            mappedResult.push({
              filename:
                v.analysis.length > 1 ? v.filename + index + 1 : v.filename,
              processedImageUrl:
                "data:image/png;base64," + e.result.result_image,
              dataList: [
                { label: "Keypoints", value: e.result?.total_keypoints },
                { label: "Filtered", value: e.result?.filtered_keypoints },
                { label: "Matches", value: e.result?.matches },
                { label: "Clusters", value: e.result?.clusters },
                { label: "Regions", value: e.result?.regions },
              ],
            })
          })
        })
        setResults(mappedResult)
        return mappedResult
      } catch (error) {
        toast({
          title: "Error!",
          description: "Failed to process image. Please try again.",
          variant: "destructive",
        })
        // toast.error("Failed to process image. Please try again.");
        console.error(error)
        return null
      }
    },
    enabled: false, // Don't run automatically
  })

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
    setImageFile(fileArray)
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
      setImagePreview(res.map((v) => v.imageUrl))
      setResults(null) // Reset results when new image is uploaded
    })
    toast({
      title: "Success!",
      description: "Files uploaded successfully",
      variant: "default",
    })
  }

  const handleMaskFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files || null
    if (!files.length) return
    const fileArray = Array.from(files)
    setMaskFile(fileArray)
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
      setMaskPreview(res.map((v) => v.imageUrl))
      setResults(null) // Reset results when new image is uploaded
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

  const handleUseMaskChange = (checked: boolean) => {
    setUseMask(checked)
    if (!checked) {
      setMaskFile(null)
      setMaskPreview(null)
    }
  }

  const handleSubmit = () => {
    if (!detector) {
      toast({
        title: "Detector Algorithm is required",
        description: "Please select a detector algorithm",
        variant: "destructive",
      })
      // toast.error("Please select a detector algorithm");
      return
    }
    refetch()
  }

  const handleExport = () => {
    if (!results?.length) return
    createZipAndDownload(results.map((v) => v.processedImageUrl))
    toast({
      title: "Success!",
      description: "Image downloaded successfully",
      variant: "default",
    })
  }

  function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64.split(",")[1]) // 去除前缀 'data:image/png;base64,' 等
    const arrayBuffer = new ArrayBuffer(binaryString.length)
    const uint8Array = new Uint8Array(arrayBuffer)

    for (let i = 0; i < binaryString.length; i++) {
      uint8Array[i] = binaryString.charCodeAt(i)
    }

    return arrayBuffer
  }

  async function createZipAndDownload(base64Images) {
    const zip = new JSZip()
    base64Images.forEach((base64, index) => {
      const fileName = `${results[index].filename}.png`
      const arrayBuffer = base64ToArrayBuffer(base64)
      zip.file(fileName, arrayBuffer, { binary: true })
    })

    // 生成 ZIP 文件
    zip.generateAsync({ type: "blob" }).then((blob) => {
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = "forgery-detection-result.zip"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    })
  }

  const detectorOptions = [
    {
      value: "BRISK",
      label: "BRISK",
      description: "Binary Robust Invariant Scalable Keypoints",
    },
    {
      value: "ORB",
      label: "ORB",
      description: "Oriented FAST and Rotated BRIEF",
    },
    {
      value: "AKAZE",
      label: "AKAZE",
      description: "Accelerated-KAZE features",
    },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white py-6">
      <div className="max-w-full mx-auto px-4 sm:px-4 lg:px-6">
        <Card className="mb-6 border-0 shadow-lg overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10 border-b border-slate-100 pb-3">
            <CardTitle className="text-xl flex items-center gap-2 text-slate-800">
              Copy-Move Forgery
            </CardTitle>
          </CardHeader>
          <CardContent className="bg-white p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Image Upload Section */}
              <div className="space-y-3">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-medium text-slate-800 text-base">
                    Image Selection
                  </h3>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="use-mask"
                      checked={useMask}
                      onCheckedChange={handleUseMaskChange}
                      className="data-[state=checked]:bg-primary"
                    />
                    <Label
                      htmlFor="use-mask"
                      className="text-sm text-slate-600"
                    >
                      Mask On/Off
                    </Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-4 w-4 text-slate-400 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="bg-slate-800 text-white border-slate-700">
                          <p>Toggle mask usage for detection</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>

                <div
                  className={`grid gap-4 ${useMask ? "sm:grid-cols-2" : "grid-cols-1"}`}
                >
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
                      {/* {imagePreview ? (
                        <div className="w-full">
                          <img
                            src={imagePreview}
                            alt="Preview"
                            className="h-28 object-contain mx-auto mb-2 rounded-md shadow-sm"
                          />
                          <p className="text-sm text-center text-slate-600 truncate bg-slate-50 p-1.5 rounded">
                            {imageFile?.name}
                          </p>
                        </div>
                      ) : ( */}
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

                  {useMask && (
                    <div className="relative">
                      <Input
                        id="mask-upload"
                        type="file"
                        multiple
                        accept="image/*,application/pdf"
                        onChange={handleMaskFileChange}
                        className="hidden"
                      />
                      <Label
                        htmlFor="mask-upload"
                        className="flex items-center justify-center p-4 border-2 border-dashed border-slate-200 rounded-md bg-white hover:bg-slate-50 cursor-pointer transition-colors hover:border-primary/50"
                      >
                        {/* {maskPreview ? (
                          <div className="w-full">
                            <img
                              src={maskPreview}
                              alt="Mask Preview"
                              className="h-28 object-contain mx-auto mb-2 rounded-md shadow-sm"
                            />
                            <p className="text-sm text-center text-slate-600 truncate bg-slate-50 p-1.5 rounded">
                              {maskFile?.name}
                            </p>
                          </div>
                        ) : ( */}
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
                            Click to upload a mask image/PDF
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            PNG, JPG, JPEG,PDF up to 10MB
                          </p>
                        </div>
                        {/* )} */}
                      </Label>
                    </div>
                  )}
                </div>
              </div>

              {/* Detector Selection and Parameters */}
              <div className="space-y-4">
                <div className="mb-2">
                  <h3 className="font-medium text-slate-800 text-base mb-3">
                    Detection Parameters
                  </h3>
                  <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                    <Label
                      htmlFor="detector"
                      className="text-sm font-medium text-slate-700 mb-2 block"
                    >
                      Detector Algorithm
                    </Label>
                    <Select
                      value={detector || undefined}
                      onValueChange={(value) =>
                        setDetector(value as DetectorType)
                      }
                    >
                      <SelectTrigger className="w-full bg-white border-slate-200 h-10">
                        <SelectValue placeholder="Select algorithm" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {detectorOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>{option.label}</span>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="right"
                                    className="bg-slate-800 text-white border-slate-700"
                                  >
                                    <p>{option.description}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <ParameterControl
                    label="Response"
                    value={response}
                    onChange={setResponse}
                    min={0}
                    max={100}
                    tooltipText="Response threshold percentage"
                    suffix="%"
                  />

                  <ParameterControl
                    label="Matching"
                    value={matching}
                    onChange={setMatching}
                    min={1}
                    max={100}
                    tooltipText="Minimum match percentage for forgery detection"
                    suffix="%"
                  />
                </div>
              </div>

              {/* Additional Parameters and Options */}
              <div className="space-y-4">
                <h3 className="font-medium text-slate-800 text-base mb-2">
                  Advanced Options
                </h3>

                <div className="grid grid-cols-2 gap-3">
                  <ParameterControl
                    label="Distance"
                    value={distance}
                    onChange={setDistance}
                    min={1}
                    max={100}
                    tooltipText="Set distance threshold for keypoint comparison"
                  />

                  <ParameterControl
                    label="Cluster"
                    value={cluster}
                    onChange={setCluster}
                    min={1}
                    max={20}
                    tooltipText="Minimum number of points forming a valid forgery cluster"
                  />
                </div>

                <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                  <h3 className="font-medium text-slate-800 text-sm mb-2">
                    Display Options
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center justify-between p-2 rounded hover:bg-slate-50">
                      <Label
                        htmlFor="hide-lines"
                        className="text-sm text-slate-700 cursor-pointer flex-1"
                      >
                        Hide Lines
                      </Label>
                      <Checkbox
                        id="hide-lines"
                        checked={hideLines}
                        onCheckedChange={(checked) =>
                          setHideLines(checked as boolean)
                        }
                        className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      />
                    </div>
                    <div className="flex items-center justify-between p-2 rounded hover:bg-slate-50">
                      <Label
                        htmlFor="show-keypoints"
                        className="text-sm text-slate-700 cursor-pointer flex-1"
                      >
                        Show Keypoints
                      </Label>
                      <Checkbox
                        id="show-keypoints"
                        checked={showKeypoints}
                        onCheckedChange={(checked) =>
                          setShowKeypoints(checked as boolean)
                        }
                        className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex space-x-3">
                  <Button
                    onClick={handleSubmit}
                    disabled={
                      isLoading ||
                      !imageFile ||
                      !detector ||
                      (useMask && !maskFile)
                    }
                    className="flex-1 h-10 font-medium shadow-sm"
                  >
                    {isLoading ? (
                      <>
                        <Loader className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      "Detect Forgery"
                    )}
                  </Button>

                  {results && (
                    <Button
                      variant="outline"
                      onClick={handleExport}
                      className="h-10 border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Content - Image Analysis and Results */}
        {!imagePreview ? (
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-slate-100">
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
                      {imagePreview &&
                        imagePreview.length > 0 &&
                        imagePreview.map((url, index) => (
                          <ImageViewer
                            className="h-[800px]"
                            key={index}
                            imageUrl={url}
                            altText="Original image"
                            type="original"
                          />
                        ))}
                    </div>
                  </div>

                  <div className="relative bg-white">
                    <div className="py-2.5 px-4 border-b bg-slate-50 flex items-center justify-between">
                      <h3 className="font-medium text-slate-700 text-sm">
                        Processed Output
                      </h3>
                      <span className="text-xs py-1 px-2 bg-blue-100 text-blue-600 rounded-full">
                        Analysis
                      </span>
                    </div>
                    <div className="p-0 h-[400px] relative">
                      {isLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center">
                            <div className="relative mb-3">
                              <div className="h-12 w-12 rounded-full border-3 border-primary/20 border-t-primary animate-spin mx-auto"></div>
                            </div>
                            <p className="text-slate-600 text-sm">
                              Processing image...
                            </p>
                          </div>
                        </div>
                      ) : results && results.length > 0 ? (
                        results.map((item, index) => (
                          <ImageViewer
                            key={index}
                            className="h-[800px]"
                            imageUrl={item.processedImageUrl}
                            altText="Processed image with forgery detection"
                            type="processed"
                          />
                        ))
                      ) : (
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
                      )}
                    </div>
                  </div>

                  <div className="relative bg-white">
                    <div className="py-2.5 px-4 border-b bg-slate-50 flex items-center justify-between">
                      <h3 className="font-medium text-slate-700 text-sm">
                        Detection Results
                      </h3>
                      <span className="text-xs py-1 px-2 bg-blue-100 text-blue-600 rounded-full">
                        Results
                      </span>
                    </div>
                    <div className="p-0 h-[400px] relative">
                      {isLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center">
                            <div className="relative mb-3">
                              <div className="h-12 w-12 rounded-full border-3 border-primary/20 border-t-primary animate-spin mx-auto"></div>
                            </div>
                            <p className="text-slate-600 text-sm">
                              Processing image...
                            </p>
                          </div>
                        </div>
                      ) : results && results.length > 0 ? (
                        results.map((item) => (
                          <div className="h-[800px] pt-2">
                            <Table className="overflow-hidden">
                              <TableHeader className="">
                                <TableRow>
                                  <TableHead className="text-center border">
                                    Type
                                  </TableHead>
                                  <TableHead className="text-center border">
                                    Number
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {item.dataList && item.dataList.length > 0
                                  ? item.dataList.map((detail, index) => (
                                      <TableRow
                                        key={detail.label}
                                        className="border-b-0"
                                      >
                                        <TableCell className="text-center font-mono border">
                                          {detail.label}
                                        </TableCell>
                                        <TableCell className="text-center border">
                                          {detail.value}
                                        </TableCell>
                                      </TableRow>
                                    ))
                                  : "N/A"}
                              </TableBody>
                            </Table>
                          </div>
                        ))
                      ) : (
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
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Results Panel (Only Shown When Results Exist) */}
            {/* {results && (
              <Card className="border shadow-sm overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10 border-b border-slate-100 py-3">
                  <CardTitle className="text-lg text-slate-800">Detection Results</CardTitle>
                </CardHeader>
                <CardContent className="bg-white p-6">
                  <ResultsPanel 
                    results={results}
                  />
                </CardContent>
              </Card>
            )} */}
          </div>
        )}
      </div>
    </div>
  )
}

export default CopyMoveForgery
