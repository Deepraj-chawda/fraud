import React, { useState, useEffect } from "react"
import { getDocument } from "pdfjs-dist"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "sonner"
import {
  Upload,
  Download,
  Loader,
  RotateCcw,
  Settings,
  Zap,
  Info,
  FileImage,
} from "lucide-react"
import ImageViewer from "@/components/copy-move-forgery/ImageViewer"
import { fetchErrorLevelAnalysis } from "@/api/services/errorLevelAnalysis"
import { isAuthenticated } from "@/api/auth"
import { useNavigate } from "react-router-dom"
import { validateFileImagePdf } from "@/lib/utils"

interface ErrorLevelParams {
  quality: number
  scale: number
  contrast: number
  linear: boolean
  greyscale: boolean
}

interface ImagePreView {
  imageUrl: string
  filename: string
  // fileType: string;
  // pageNum: number;
  // fileSize: number;
  // lastFlag: boolean;
}

const ErrorLevelAnalysis = () => {
  const [selectedFile, setSelectedFile] = useState<File[] | null>(null)
  const [originalImageUrl, setOriginalImageUrl] = useState<string[]>(null)
  const [processedImageUrl, setProcessedImageUrl] =
    useState<ImagePreView[]>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [params, setParams] = useState<ErrorLevelParams>({
    quality: 59,
    scale: 68,
    contrast: 87,
    linear: false,
    greyscale: false,
  })

  const navigate = useNavigate()
  useEffect(() => {
    if (!isAuthenticated()) {
      toast.error("Please log in to access this page", {
        style: {
          background: "#f44336", // 红色背景
          color: "#FFFFFF",
        },
      })
      navigate("/login")
    }
  }, [navigate, toast])

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files.length) return
    const fileArray = Array.from(files)
    const res = validateFileImagePdf(fileArray)
    if (!res.flag) {
      toast.error(res.message)
      return
    }
    setSelectedFile(fileArray)
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
      setOriginalImageUrl(res.map((v) => v.imageUrl))
      setProcessedImageUrl(null) // Reset results when new image is uploaded
    })
    toast.success("Files uploaded successfully")
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
          // fileType:file.type,
          // pageNum:pageNum,
          // lastFlag: pageNum===numPages,
          // fileSize:file.size,
        })
        canvas.remove()
      } catch (error) {
        console.error("Error processing page:", error)
        continue
      }
    }
    return fileURLs
  }

  const handleApplyAnalysis = async () => {
    if (!selectedFile) {
      toast.error("Please select an image first")
      return
    }

    if (params.quality < 1 || params.quality > 100) {
      toast.error("Quality must be between 1 and 100")
      return
    }

    if (params.scale < 1 || params.scale > 100) {
      toast.error("Scale must be between 1 and 100")
      return
    }

    if (params.contrast < 0 || params.contrast > 100) {
      toast.error("Contrast must be between 0 and 100")
      return
    }

    setIsProcessing(true)
    try {
      const response = await fetchErrorLevelAnalysis(
        selectedFile,
        params.quality,
        params.scale,
        params.contrast,
        params.linear,
        params.greyscale
      )
      const processedResult: ImagePreView[] = []
      response.results.forEach((v) => {
        if (Array.isArray(v.analysis)) {
          v.analysis.forEach((item) =>
            processedResult.push({
              filename: v.filename,
              imageUrl: item.analysis?.result_image,
            })
          )
        } else {
          processedResult.push({
            filename: v.filename,
            imageUrl: v.analysis?.result_image,
          })
        }
      })
      setProcessedImageUrl(processedResult)
      toast.success("Error level analysis completed successfully")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to complete error level analysis"
      )
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReset = () => {
    setParams({
      quality: 59,
      scale: 68,
      contrast: 87,
      linear: false,
      greyscale: false,
    })
    setProcessedImageUrl(null)
    toast.success("Parameters reset to default")
  }

  const handleExportProcessed = () => {
    if (!processedImageUrl) {
      toast.error("No processed image to export")
      return
    }
    // const link = document.createElement('a');
    // link.href = processedImageUrl;
    // link.download = `error_level_analysis_${selectedFile?.name || 'image.png'}`;
    // link.click();
    createZipAndDownload(processedImageUrl)
    toast.success("Processed image exported")
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

    base64Images.forEach((item) => {
      const fileName = `${item.filename}.png`
      const arrayBuffer = base64ToArrayBuffer(item.imageUrl)
      zip.file(fileName, arrayBuffer, { binary: true })
    })

    // 生成 ZIP 文件
    zip.generateAsync({ type: "blob" }).then((blob) => {
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = "error_level_analysis_result.zip"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    })
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-full mx-auto space-y-4">
        {/* Compact Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Error Level Analysis
            </h1>
            <p className="text-sm text-muted-foreground">
              Detect image tampering through compression artifact analysis
            </p>
          </div>
          <Badge variant="outline" className="text-xs">
            <Settings className="w-3 h-3 mr-1" />
            ELA Engine
          </Badge>
        </div>

        {/* Controls Panel */}
        <Card className="shadow-sm">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-end p-3">
            {/* File Upload with Preview */}
            <div className="lg:col-span-1">
              <div className="relative">
                <Input
                  id="image-upload"
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Label
                  htmlFor="image-upload"
                  className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-muted-foreground/25 rounded-md bg-muted/20 hover:bg-muted/30 cursor-pointer transition-colors overflow-hidden"
                >
                  {/* {originalImageUrl ? (
                      <img
                        src={originalImageUrl}
                        alt="Preview"
                        className="w-full h-full object-cover rounded-md"
                      />
                    ) : ( */}
                  <>
                    <Upload className="h-4 w-4 text-muted-foreground mb-1" />
                    <span className="text-xs text-muted-foreground">
                      Upload Image
                    </span>
                  </>
                  {/* )} */}
                </Label>
              </div>
            </div>

            <div className="w-full flex flex-col items-start gap-2">
              {/* Quality Control */}
              <div className="w-full">
                <div className="flex items-center gap-1 mb-2">
                  <Label className="text-sm font-medium">Quality</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>JPEG compression quality for analysis</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="space-y-2">
                  <Slider
                    value={[params.quality]}
                    onValueChange={(value) =>
                      setParams((prev) => ({ ...prev, quality: value[0] }))
                    }
                    max={100}
                    min={1}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1%</span>
                    <span className="text-primary font-medium">
                      {params.quality}%
                    </span>
                    <span>100%</span>
                  </div>
                </div>
              </div>

              {/* Scale Control */}
              <div className="w-full">
                <div className="flex items-center gap-1 mb-2">
                  <Label className="text-sm font-medium">Scale</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Output scaling factor</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="space-y-2">
                  <Slider
                    value={[params.scale]}
                    onValueChange={(value) =>
                      setParams((prev) => ({ ...prev, scale: value[0] }))
                    }
                    max={100}
                    min={1}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1%</span>
                    <span className="text-primary font-medium">
                      {params.scale}%
                    </span>
                    <span>100%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="w-full flex flex-col items-start gap-2">
              <div className="flex gap-3 w-full ">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="linear"
                    checked={params.linear}
                    onCheckedChange={(checked) =>
                      setParams((prev) => ({
                        ...prev,
                        linear: Boolean(checked),
                      }))
                    }
                  />
                  <Label htmlFor="linear" className="text-sm">
                    Linear
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="greyscale"
                    checked={params.greyscale}
                    onCheckedChange={(checked) =>
                      setParams((prev) => ({
                        ...prev,
                        greyscale: Boolean(checked),
                      }))
                    }
                  />
                  <Label htmlFor="greyscale" className="text-sm">
                    Greyscale
                  </Label>
                </div>
              </div>

              {/* Contrast Control */}
              <div className="w-full">
                <div className="flex items-center gap-1 mb-2">
                  <Label className="text-sm font-medium">Contrast</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Error visibility enhancement</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="space-y-2">
                  <Slider
                    value={[params.contrast]}
                    onValueChange={(value) =>
                      setParams((prev) => ({ ...prev, contrast: value[0] }))
                    }
                    max={100}
                    min={0}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0%</span>
                    <span className="text-primary font-medium">
                      {params.contrast}%
                    </span>
                    <span>100%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div className="w-full flex flex-col items-start gap-2">
              <div className="w-full flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="w-full"
                >
                  <span>Reset to Default</span>
                  <RotateCcw className="h-3 w-3" />
                </Button>
                {processedImageUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportProcessed}
                    className="w-full"
                  >
                    <span>Download Image</span>
                    <Download className="h-3 w-3" />
                  </Button>
                )}
              </div>

              <div className="w-full">
                <Button
                  onClick={handleApplyAnalysis}
                  disabled={!selectedFile || isProcessing}
                  size="sm"
                  className="flex-1 w-full"
                >
                  {isProcessing ? (
                    <>
                      <Loader className="mr-1 h-3 w-3 animate-spin" />
                      Analyzing
                    </>
                  ) : (
                    <>
                      <Zap className="mr-1 h-3 w-3" />
                      Analyze Image
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Results Panel */}
        {!originalImageUrl ? (
          <Card className="h-96 flex items-center justify-center">
            <div className="text-center">
              <FileImage className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-medium mb-1">No Image Selected</h3>
              <p className="text-sm text-muted-foreground">
                Upload an image to perform error level analysis
              </p>
            </div>
          </Card>
        ) : (
          <Card style={{ marginBottom: "4rem" }}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Analysis Results</CardTitle>
                {/* <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    Original: {selectedFile?.name}
                  </Badge>
                  {processedImageUrl && (
                    <Badge className="text-xs bg-green-600">
                      Analysis Complete
                    </Badge>
                  )}
                </div> */}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-1 md:grid-cols-2 h-96">
                {/* Original Image */}
                <div className="border-r border-border">
                  <div className="px-4 py-2 border-b bg-muted/30">
                    <h4 className="text-sm font-medium">Original</h4>
                  </div>
                  <div className="">
                    {originalImageUrl &&
                      originalImageUrl.length &&
                      originalImageUrl.map((item, index) => (
                        <ImageViewer
                          key={index}
                          className="h-[800px]"
                          imageUrl={item}
                          altText="Original image"
                          type="original"
                        />
                      ))}
                  </div>
                </div>

                {/* Analysis Result */}
                <div>
                  <div className="px-4 py-2 border-b bg-muted/30">
                    <h4 className="text-sm font-medium">
                      Error Level Analysis
                    </h4>
                  </div>
                  <div className="h-full">
                    {isProcessing ? (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                          <Loader className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                          <p className="text-sm text-muted-foreground">
                            Processing...
                          </p>
                        </div>
                      </div>
                    ) : processedImageUrl && processedImageUrl.length > 0 ? (
                      processedImageUrl.map((item, index) => (
                        <ImageViewer
                          key={index}
                          imageUrl={item.imageUrl}
                          className="h-[800px]"
                          altText="Error level analysis result"
                          type="processed"
                        />
                      ))
                    ) : (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                          <Zap className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">
                            Click analyze to see results
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

export default ErrorLevelAnalysis
