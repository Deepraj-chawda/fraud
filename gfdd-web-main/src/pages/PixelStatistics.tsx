import React, { useState, useRef, useEffect } from "react"
import { getDocument } from "pdfjs-dist"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Label } from "@/components/ui/label"
import { Info, Upload, BarChart2, Download } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import ImageViewer from "@/components/copy-move-forgery/ImageViewer"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fetchImageStats } from "@/api/services/imageStats"
import { PixelStatisticsParams, ProcessingMode } from "../types/apiTypes"
import { isAuthenticated } from "@/api/auth"
import { useNavigate } from "react-router-dom"
import { validateFileImagePdf } from "@/lib/utils"
// // 设置 Worker 脚本的路径
// GlobalWorkerOptions.workerSrc = '/vender/pdf.worker.mjs';

// Define the stats interface
interface PixelStatistics {
  type: string
  result: string
  alert: string
  fraud: string
}

interface imageSummary {
  mode: ProcessingMode
  inclusive: boolean
  filename: string
  details: PixelStatistics[]
  csvRows: []
}

interface ApiResponse {
  imageUrl: string
  filename: string
  stats: PixelStatistics
  mode: ProcessingMode
  inclusive: boolean
}
interface ImagePreView {
  imageUrl: string
  filename: string
  fileType: string
  pageNum: number
  fileSize: number
  lastFlag: boolean
}

const PixelStatistics = () => {
  // State management
  const [selectedImage, setSelectedImage] = useState<File[] | null>(null)
  const [imagePreview, setImagePreview] = useState<ImagePreView[] | null>(null)
  const [processedImage, setProcessedImage] = useState<string[] | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [SummaryStatistics, setSummaryStatistics] = useState<
    imageSummary[] | null
  >(null)
  const [responseData, setResponseData] = useState<ApiResponse[] | null>(null)
  // Refs
  const originalContainerRef = useRef<HTMLDivElement>(null)
  const processedContainerRef = useRef<HTMLDivElement>(null)
  const [params, setParams] = useState<PixelStatisticsParams>({
    radius: 2,
    contrast: 85,
    grayscale: false,
    anti_forensics: false,
    inclusive: false,
    mode: "Distance",
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

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files.length) return
    const fileArray = Array.from(files)
    const res = validateFileImagePdf(fileArray)
    if (!res.flag) {
      toast.error(res.message)
      return
    }
    setSelectedImage(fileArray)
    setIsPreviewing(true)
    // 创建一个数组，用于存储每个文件的处理结果
    const filePromises = fileArray.map(async (file, index) => {
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
      setIsPreviewing(false)
      setImagePreview(res)
      setProcessedImage(null)
      setSummaryStatistics(null)
      setResponseData(null)
    })
    toast.success("Files uploaded successfully")
  }

  const handleRadiusChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value)
    if (!isNaN(value) && value >= 1 && value <= 15) {
      setParams((prev) => ({ ...prev, radius: value }))
    }
  }

  // Process image
  const processImage = async () => {
    if (!selectedImage) {
      toast.error("Please upload an image first")
      return
    }

    setIsProcessing(true)
    try {
      const result = await fetchImageStats(selectedImage, params)
      let imageList = []
      let _responseData = []
      let _list = []
      result.pca_results.forEach((item) => {
        item.forEach((one) => {
          imageList.push(one.result_image)
          _responseData.push({
            imageUrl: one.result_image,
            filename: one.filename,
          })
        })
      })
      result.extra_messages.forEach((item) => {
        _list.push({
          mode: params.mode, //one.mode,
          inclusive: params.inclusive, //one.inclusive,
          filename: item.filename,
          csvRow: [],
          details: [
            {
              type: "Metadata Analysis",
              result: item.metedata_test,
              alert: item.alert_message_metedata?.join(",") || "N/A",
              fraud: item.potential_fraud,
            },
            {
              type: "Pixel & AI Analysis",
              result: item.pixel_test,
              alert: item.alert_message_pixel?.join(",") || "N/A",
              fraud: item.potential_fraud,
            },
            {
              type: "PCA",
              result: item.pca_test,
              alert: item.alert_message_pca?.join(",") || "N/A",
              fraud: item.potential_fraud,
            },
            {
              type: "AI Detection",
              result: item.ai_test,
              alert: item.alert_message_ai?.join(",") || "N/A",
              fraud: item.potential_fraud,
            },
          ],
        })
      })

      setSummaryStatistics(_list)
      setProcessedImage(imageList)
      setResponseData(_responseData)
      setIsProcessing(false)
      toast.success("Image processed successfully!")
    } catch (error) {
      console.error("Error processing image:", error)
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to process image. Please try again."
      )
      setIsProcessing(false)
    }
  }

  const handleExportCSV = () => {
    // Filter files with valid results
    // const validFiles = SummaryStatistics.filter(file => file.result && file.result !== 'pending');
    console.log(SummaryStatistics, 332)
    if (SummaryStatistics.length === 0) {
      toast.error("Please analyze images before exporting results")
      return
    }

    // CSV header
    const headers = [
      "",
      "Algorithm / Test",
      "Pass / Fail Test",
      "Alert Messages",
      "Potential Fraud",
    ]

    // 生成多个 sheet 的 CSV 内容
    const sheets = []
    // Add data rows
    SummaryStatistics.forEach((file) => {
      const filename = file.filename // Escape quotes in filename
      const csvRows = [headers.join(",")]
      file.details.forEach((item) => {
        const row = [
          "",
          item.type || "N/A",
          // Convert percentages back to decimals for CSV
          item.result || "N/A",
          item.alert?.split(",")?.join("/") || "N/A",
          item.fraud || "N/A",
        ]
        csvRows.push(row.join(","))
      })
      sheets.push(`"${filename}"\n${csvRows.join("\n")}`)
    })

    // Create CSV content
    const csvContent = sheets.join("\n\n\n")
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "Pixel & AI Analysis.csv"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    toast.success("Results have been exported as CSV")
  }

  return (
    <div className="container max-w-full px-2 py-3 md:px-6">
      <h1 className="text-2xl font-bold text-foreground mb-4">
        Pixel & AI Analysis
      </h1>

      {/* Controls Section - Modern, compact design */}
      <Card className="mb-4 shadow-sm glass-card border-opacity-50">
        <CardHeader className="py-2 px-4 border-b border-border/40">
          <CardTitle className="text-lg font-medium flex items-center">
            <span className="bg-primary/10 text-primary p-1.5 rounded-md mr-2">
              <Info className="h-4 w-4" />
            </span>
            Image Processing Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap gap-3 items-center">
            {/* Upload Button - Modern styling */}
            <div className="flex-shrink-0 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => document.getElementById("image-upload")?.click()}
                className="border-primary/20 hover:bg-primary/5 hover:text-primary transition-all"
              >
                <Upload className="h-4 w-4 mr-1.5" /> Upload File
              </Button>
              <input
                id="image-upload"
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={handleImageUpload}
              />
              {/* {selectedImage && (
                <span className="text-xs text-muted-foreground max-w-[150px] truncate bg-secondary/50 px-2 py-0.5 rounded">
                  {selectedImage.name}
                </span>
              )} */}
            </div>

            {/* Mode Selector - Modern, button-like styling */}
            <div className="flex items-center gap-2 border-l pl-4 border-border/30">
              <span className="text-sm font-medium text-muted-foreground">
                Mode:
              </span>
              <RadioGroup
                value={params.mode}
                onValueChange={(value) =>
                  setParams((prev) => ({
                    ...prev,
                    mode: value as ProcessingMode,
                  }))
                }
                className="flex gap-2"
              >
                <div className="flex items-center space-x-1 bg-secondary/50 px-2 py-1 rounded-md">
                  <RadioGroupItem
                    value="Distance"
                    id="Distance"
                    className="h-3.5 w-3.5"
                  />
                  <Label htmlFor="Distance" className="text-xs cursor-pointer">
                    Distance
                  </Label>
                </div>
                <div className="flex items-center space-x-1 bg-secondary/50 px-2 py-1 rounded-md">
                  <RadioGroupItem
                    value="Projection"
                    id="Projection"
                    className="h-3.5 w-3.5"
                  />
                  <Label
                    htmlFor="Projection"
                    className="text-xs cursor-pointer"
                  >
                    Projection
                  </Label>
                </div>
                <div className="flex items-center space-x-1 bg-secondary/50 px-2 py-1 rounded-md">
                  <RadioGroupItem
                    value="Cross Product"
                    id="Cross Product"
                    className="h-3.5 w-3.5"
                  />
                  <Label
                    htmlFor="Cross Product"
                    className="text-xs cursor-pointer"
                  >
                    Cross Product
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Inclusive Checkbox - Modern styling */}
            <div className="flex items-center gap-1.5 border-l pl-4 border-border/30">
              <div className="flex items-center gap-1 bg-secondary/50 px-2.5 py-1 rounded-md">
                <Checkbox
                  id="inclusive"
                  checked={params.inclusive}
                  onCheckedChange={(checked) =>
                    setParams((prev) => ({
                      ...prev,
                      inclusive: checked === true,
                    }))
                  }
                  className="h-3.5 w-3.5 rounded-sm"
                />
                <Label htmlFor="inclusive" className="text-xs cursor-pointer">
                  Inclusive
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-muted-foreground ml-0.5 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="text-xs max-w-[200px]"
                    >
                      <p>Includes edge pixels in the processing calculation</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            {/* Options and Controls */}
            <div className="lg:col-span-2 space-y-3 pl-3">
              <div className="flex items-center space-x-2 bg-secondary/50">
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
            </div>
            {/* Radius Parameter */}
            <div className="pl-3">
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
                  className="h-9 text-center w-[100px]"
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            </div>

            {/* Contrast Control */}
            <div className="pl-4">
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
              <div className="space-y-2 m">
                <Slider
                  value={[params.contrast]}
                  onValueChange={(value) =>
                    setParams((prev) => ({ ...prev, contrast: value[0] }))
                  }
                  max={100}
                  min={0}
                  step={1}
                  className="w-[200px]"
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

            <div className="flex flex-col justify-end ml-3">
              {/* Process Button - Prominent styling */}
              <Button
                onClick={processImage}
                disabled={!selectedImage || isProcessing}
                size="sm"
                className="ml-auto bg-primary hover:bg-primary/90 shadow-sm w-full"
              >
                {isProcessing ? "Processing..." : "Process Image"}
              </Button>
              <Button
                onClick={handleExportCSV}
                variant="outline"
                size="sm"
                className="w-full sm:w-auto mt-3"
                disabled={
                  isProcessing ||
                  (SummaryStatistics && SummaryStatistics.length === 0)
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Export Results
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Images & Stats Display Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-[calc(100vh-220px)]">
        {/* Original Image - Left Column */}
        <Card className="shadow-sm border-opacity-40 h-full card-gradient-cool lg:col-span-1">
          <CardHeader className="py-2 px-3 border-b border-border/40 bg-background/50">
            <CardTitle className="text-sm font-medium flex items-center">
              <span className="h-2 w-2 rounded-full bg-primary/70 mr-2"></span>
              Original File
            </CardTitle>
          </CardHeader>
          <div className={`${isPreviewing ? "" : " h-full"}`}>
            {isPreviewing ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
                  <div
                    className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary/30 animate-spin"
                    style={{ animationDuration: "1.5s" }}
                  ></div>
                </div>
                <p className="text-sm text-muted-foreground mt-4">
                  Processing image...
                </p>
              </div>
            ) : imagePreview && imagePreview.length > 0 ? (
              imagePreview.map((item, index) => (
                <div key={index}>
                  <CardContent
                    className="p-0 relative "
                    ref={originalContainerRef}
                  >
                    <ImageViewer
                      className="h-[800px]"
                      key={`${index}-${item.pageNum}`}
                      imageUrl={item.imageUrl}
                      altText={item.filename}
                      type="original"
                    />
                  </CardContent>
                  {item.lastFlag ? (
                    <CardFooter className="py-1.5 px-3 bg-muted/30 border-t border-border/20">
                      <div className="flex items-center">
                        <Badge
                          variant="outline"
                          className="text-xs font-normal"
                        >
                          {item.filename}
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-2">
                          {Math.round(item.fileSize / 1024)} KB
                        </span>
                      </div>
                    </CardFooter>
                  ) : (
                    ""
                  )}
                </div>
              ))
            ) : (
              <CardContent
                className="p-0 h-full flex-grow relative"
                ref={originalContainerRef}
              >
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4 bg-secondary/10">
                  <div className="bg-primary/5 rounded-full p-4 mb-3">
                    <Upload className="h-6 w-6 text-primary/60" />
                  </div>
                  <p className="text-sm">Upload an image to get started</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supported formats: JPG, PNG, WebP, PDF
                  </p>
                </div>
              </CardContent>
            )}
          </div>
        </Card>

        {/* Processed Image - Center Column */}
        <Card className=" flex flex-col h-full shadow-sm border-opacity-40 card-gradient-warm lg:col-span-1">
          <CardHeader className="py-2 px-3 border-b border-border/40 bg-background/50">
            <CardTitle className="text-sm font-medium flex items-center">
              <span className="h-2 w-2 rounded-full bg-blue-500 mr-2"></span>
              Processed Output
            </CardTitle>
          </CardHeader>
          <CardContent
            className="p-0 flex-grow overflow-auto relative"
            ref={processedContainerRef}
          >
            {isProcessing ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
                  <div
                    className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary/30 animate-spin"
                    style={{ animationDuration: "1.5s" }}
                  ></div>
                </div>
                <p className="text-sm text-muted-foreground mt-4">
                  Processing image...
                </p>
              </div>
            ) : processedImage && processedImage.length ? (
              processedImage.map((imageUrl, index) => (
                // <div className='h-full'>
                <ImageViewer
                  className="h-[800px]"
                  key={responseData[index].filename}
                  imageUrl={imageUrl}
                  altText={responseData[index].filename}
                  type="processed"
                  // stats={statistics || undefined}
                  showStats={true}
                />
                // </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4 bg-secondary/10">
                <div className="bg-blue-500/5 rounded-full p-4 mb-3">
                  <Info className="h-6 w-6 text-blue-400" />
                </div>
                <p className="text-sm">Process an image to see results here</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Select settings and click "Process Image"
                </p>
              </div>
            )}
          </CardContent>
          {responseData && (
            <CardFooter className="py-1.5 px-3 bg-muted/30 border-t border-border/20">
              <div className="flex items-center gap-2">
                {/* <Badge className="bg-blue-600 hover:bg-blue-700 text-xs">
                    {responseData.mode.charAt(0).toUpperCase() + responseData.mode.slice(1)}
                  </Badge>
                  {responseData.inclusive && 
                    <Badge variant="outline" className="text-xs border-green-500/30 text-green-600">
                      Inclusive
                    </Badge>
                  } */}
              </div>
            </CardFooter>
          )}
        </Card>

        {/* Statistics Section - Right Column */}
        <Card className="overflow-hidden1 flex flex-col h-full shadow-sm border-opacity-40 bg-gradient-to-br from-slate-50 to-slate-100 lg:col-span-1">
          <CardHeader className="py-2 px-3 border-b border-border/40 bg-background/50">
            <CardTitle className="text-sm font-medium flex items-center">
              <span className="h-2 w-2 rounded-full bg-violet-500 mr-2"></span>
              Pixel & AI Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 flex-grow overflow-auto">
            {SummaryStatistics && SummaryStatistics.length > 0 ? (
              SummaryStatistics.map((summary, index) => (
                <div
                  className="space-y-6 h-[800px]"
                  key={summary.filename + index}
                >
                  {/* Summary Card */}
                  <Card className="bg-white shadow-sm ">
                    <CardContent className="p-4">
                      <div className="text-sm font-medium mb-2 text-muted-foreground">
                        Summary
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        {/* <div className="text-center">
                          <div className="text-sm text-muted-foreground">Mode</div>
                          <div className="text-lg font-medium capitalize">{summary?.mode || "N/A"}</div>
                        </div> */}
                        <div className="text-center">
                          <div className="text-sm text-muted-foreground">
                            Filename
                          </div>
                          <div
                            className="text-sm font-medium truncate"
                            title={summary?.filename}
                          >
                            {summary?.filename || "N/A"}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm text-muted-foreground">
                            Inclusive
                          </div>
                          <div className="text-lg font-medium">
                            {summary?.inclusive ? "Yes" : "No"}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Detail Stats */}
                  <div className="space-y-4">
                    <div className="text-sm font-medium mb-2 text-muted-foreground">
                      Analysis Summary
                    </div>

                    {/* RGB Values Table */}
                    <Table className="overflow-hidden">
                      <TableHeader className="">
                        <TableRow>
                          <TableHead className="text-center border">
                            Algorithm / Test
                          </TableHead>
                          <TableHead className="text-center border">
                            Pass / Fail Test
                          </TableHead>
                          <TableHead className="text-center border">
                            Alert Messages
                          </TableHead>
                          <TableHead className="text-center border">
                            Potential Fraud
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.details && summary.details.length > 0
                          ? summary.details.map((detail, index) => (
                              <TableRow
                                key={detail.type}
                                className="border-b-0"
                              >
                                <TableCell className="border">
                                  <div className="flex items-center">
                                    <span>{detail.type}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-mono border">
                                  {detail.result}
                                </TableCell>
                                <TableCell className="text-right border">
                                  {detail.alert}
                                </TableCell>
                                <TableCell
                                  colSpan={1}
                                  className={`text-right relative left-30 ${
                                    index === 0
                                      ? "border border-b border-gray-300"
                                      : "border-b-0"
                                  }`}
                                  rowSpan={4}
                                  style={{
                                    visibility:
                                      index === 0 ? "visible" : "hidden",
                                    padding: index === 0 ? "auto" : "0",
                                    width: index === 0 ? "auto" : "0",
                                    display: index === 0 ? "" : "inline-block",
                                  }}
                                >
                                  {detail.fraud}
                                </TableCell>
                              </TableRow>
                            ))
                          : "N/A"}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Additional Info */}
                  {/* <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-600">
                    <div className="flex items-center mb-1">
                      <Info className="h-3.5 w-3.5 mr-1" />
                      <span className="font-medium">Analysis Details</span>
                    </div>
                    <p>
                      This analysis shows the distribution of red, green, and blue pixel values in the 
                      image using the {summary?.mode} processing mode.
                      {summary?.inclusive 
                        ? " Edge pixels were included in the calculation." 
                        : " Edge pixels were excluded from the calculation."
                      }
                    </p>
                  </div> */}
                </div>
              ))
            ) : (
              <div className="h-full flex items-center justify-center text-center">
                <div className="max-w-xs">
                  <div className="mx-auto bg-slate-100 rounded-full h-12 w-12 flex items-center justify-center mb-3">
                    <BarChart2 className="h-6 w-6 text-slate-400" />
                  </div>
                  <h3 className="text-lg font-medium">
                    No Statistics Available
                  </h3>
                  <p className="text-sm text-muted-foreground mt-2">
                    Upload and process an image to view detailed pixel
                    statistics.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {/* </div> */}
    </div>
  )
}

export default PixelStatistics
