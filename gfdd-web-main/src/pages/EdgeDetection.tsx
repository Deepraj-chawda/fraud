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
import { fetchEdgeDetection } from "@/api/services/edgeDetection"
import { isAuthenticated } from "@/api/auth"
import { useNavigate } from "react-router-dom"
import { validateFileImagePdf } from "@/lib/utils"

interface EdgeDetectionParams {
  radius: number
  contrast: number
  grayscale: boolean
  anti_forensics: boolean
}

interface ImagePreView {
  imageUrl: string
  filename: string
  fileType: string
  // pageNum: number;
  // fileSize: number;
  // lastFlag: boolean;
}

const EdgeDetection = () => {
  const [selectedFile, setSelectedFile] = useState<ImagePreView[] | null>(null)
  const [originalFile, setOriginalFile] = useState<File[] | null>(null)
  const [processedImageUrl, setProcessedImageUrl] = useState<string[] | null>(
    null
  )
  const [processedImageInfo, setProcessedImageInfo] = useState<
    ImagePreView[] | null
  >(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [params, setParams] = useState<EdgeDetectionParams>({
    radius: 3,
    contrast: 50,
    grayscale: false,
    anti_forensics: false,
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
    setOriginalFile(fileArray)
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
              const pdf = await getDocument(e.target.result as string).promise
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
      setSelectedFile(res)
      setIsPreviewing(false)
      setProcessedImageUrl(null)
      setProcessedImageInfo(null)
    })
    toast.success("Files uploaded successfully")
  }

  const handleApplyFilter = async () => {
    if (!selectedFile) {
      toast.error("Please select an image first")
      return
    }

    if (params.radius < 1 || params.radius > 15) {
      toast.error("Radius must be between 1 and 15 pixels")
      return
    }

    if (params.contrast < 0 || params.contrast > 100) {
      toast.error("Contrast must be between 0 and 100")
      return
    }

    setIsProcessing(true)
    try {
      const response = await fetchEdgeDetection(
        originalFile,
        params.radius,
        params.contrast,
        params.grayscale,
        params.anti_forensics
      )
      // setProcessedImageUrl(response.imageUrl);
      const output = []
      response.results.forEach((item) => {
        item.analysis.forEach((v, index) => {
          output.push({
            filename:
              item.analysis.length > 1
                ? item.filename + index + 1
                : item.filename,
            imageUrl: "data:image/png;base64," + v.result?.result_image,
          })
        })
      })
      setProcessedImageInfo(output)
      setProcessedImageUrl(output.map((v) => v.imageUrl))
      toast.success("Edge detection filter applied successfully")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to apply edge detection filter"
      )
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReset = () => {
    setParams({
      radius: 3,
      contrast: 50,
      grayscale: false,
      anti_forensics: false,
    })
    setProcessedImageUrl(null)
    setProcessedImageInfo(null)
    toast.success("Parameters reset to default")
  }

  const handleExportProcessed = () => {
    if (!processedImageUrl) {
      toast.error("No processed image to export")
      return
    }
    createZipAndDownload(processedImageUrl)
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
      const fileName = `${processedImageInfo[index].filename}.png`
      const arrayBuffer = base64ToArrayBuffer(base64)
      zip.file(fileName, arrayBuffer, { binary: true })
    })

    // 生成 ZIP 文件
    zip.generateAsync({ type: "blob" }).then((blob) => {
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = "edge detection.zip"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    })
  }

  const handleRadiusChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value)
    if (!isNaN(value) && value >= 1 && value <= 15) {
      setParams((prev) => ({ ...prev, radius: value }))
    }
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-full mx-auto space-y-4">
        {/* Compact Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Edge Detection Filter
            </h1>
          </div>
          <Badge variant="outline" className="text-xs">
            <Settings className="w-3 h-3 mr-1" />
            Filter Engine
          </Badge>
        </div>

        {/* Controls Panel */}
        <Card className="shadow-sm">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-end px-3 py-5">
            {/* File Upload with Preview */}
            <div className="lg:col-span-1">
              <div className="relative">
                <Input
                  id="image-upload"
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Label
                  htmlFor="image-upload"
                  className="flex flex-col items-center justify-center h-28 border-2 border-dashed border-muted-foreground/25 rounded-md bg-muted/20 hover:bg-muted/30 cursor-pointer transition-colors overflow-hidden"
                >
                  <>
                    <Upload className="h-4 w-4 text-muted-foreground mb-1" />
                    <span className="text-xs text-muted-foreground">
                      Upload Image/PDF
                    </span>
                  </>
                  {/* {originalImageUrl ? (
                    <img
                      src={originalImageUrl}
                      alt="Preview"
                      className="w-full h-full object-cover rounded-md"
                    />
                  ) : (
                    <>
                      <Upload className="h-4 w-4 text-muted-foreground mb-1" />
                      <span className="text-xs text-muted-foreground">Upload Image/PDF</span>
                    </>
                  )} */}
                </Label>
              </div>
            </div>

            {/* Radius Parameter */}
            <div>
              <div className="flex items-center gap-1 mb-2">
                <Label className="text-sm font-medium">Radius</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Detection sensitivity (1-15px)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  max="15"
                  value={params.radius}
                  onChange={handleRadiusChange}
                  className="h-9 text-center"
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            </div>

            {/* Contrast Control */}
            <div>
              <div className="flex items-center gap-1 mb-2">
                <Label className="text-sm font-medium">Contrast</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Edge visibility enhancement</p>
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

            {/* Options and Controls */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="grayscale"
                  checked={params.grayscale}
                  onCheckedChange={(checked) =>
                    setParams((prev) => ({
                      ...prev,
                      grayscale: Boolean(checked),
                    }))
                  }
                />
                <Label htmlFor="grayscale" className="text-sm">
                  Grayscale Output
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="grayscale"
                  checked={params.anti_forensics}
                  onCheckedChange={(checked) =>
                    setParams((prev) => ({
                      ...prev,
                      anti_forensics: Boolean(checked),
                    }))
                  }
                />
                <Label htmlFor="grayscale" className="text-sm">
                  Anti Forensics
                </Label>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleApplyFilter}
                  disabled={!selectedFile || isProcessing}
                  size="sm"
                  className="flex-1"
                >
                  {isProcessing ? (
                    <>
                      <Loader className="mr-1 h-3 w-3 animate-spin" />
                      Processing
                    </>
                  ) : (
                    <>
                      <Zap className="mr-1 h-3 w-3" />
                      Apply Filter
                    </>
                  )}
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset}>
                  <span>Reset to Default</span>
                  <RotateCcw className="h-3 w-3" />
                </Button>
                {processedImageUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportProcessed}
                  >
                    <span>Download Image</span>
                    <Download className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Results Panel */}
        {!selectedFile ? (
          <Card className="h-96 flex items-center justify-center ">
            <div className="text-center">
              <FileImage className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-medium mb-1">No Image Selected</h3>
              <p className="text-sm text-muted-foreground">
                Upload an image to apply edge detection filter
              </p>
            </div>
          </Card>
        ) : (
          <Card className="pb-5" style={{ marginBottom: "2rem" }}>
            <CardHeader className="pb-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Filter Results </CardTitle>
                {/* <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    { Original: {selectedFile?.name} }
                  </Badge>
                  {processedImageUrl && (
                    <Badge className="text-xs bg-green-600">
                      Filter Applied
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
                  {selectedFile &&
                    selectedFile.length &&
                    selectedFile.map((item, index) => (
                      <ImageViewer
                        key={item.filename + index}
                        className="h-[800px]"
                        imageUrl={item.imageUrl}
                        altText={item.filename}
                        type="original"
                      />
                    ))}
                </div>

                {/* Processed Image */}
                <div>
                  <div className="px-4 py-2 border-b bg-muted/30">
                    <h4 className="text-sm font-medium">Edge Detected</h4>
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
                          className="h-[800px]"
                          imageUrl={item}
                          altText="Edge detected image"
                          type="processed"
                        />
                      ))
                    ) : (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                          <Zap className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">
                            Apply filter to see results
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

export default EdgeDetection
