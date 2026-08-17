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
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Label } from "@/components/ui/label"
import { Info, Upload, BarChart2, Download } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import MultiSelect from "@/components/ui/multiSelect"
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
import { fetchOCRAnalysis } from "@/api/services/ocrAnalysis"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { OcrAnalysisParams, ProcessingMode } from "../types/apiTypes"
import { isAuthenticated } from "@/api/auth"
import { useNavigate } from "react-router-dom"
import { validateFileImagePdf } from "@/lib/utils"

// Define the stats interface
interface PixelStatistics {
  type: string
  result: string
  alert: string
  fraud: string
}
interface imageSummary {
  filename: string
  content: string
  details: PixelStatistics[]
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

const OCRAnalysis = () => {
  // State management
  const [selectedImage, setSelectedImage] = useState<File[] | null>(null)
  const [imagePreview, setImagePreview] = useState<ImagePreView[] | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [summaryStatistics, setSummaryStatistics] = useState<
    imageSummary[] | null
  >(null)
  const [responseData, setResponseData] = useState<ApiResponse[] | null>(null)
  // Refs
  const originalContainerRef = useRef<HTMLDivElement>(null)
  const processedContainerRef = useRef<HTMLDivElement>(null)
  const [useMask, setUseMask] = useState<boolean>(false)
  const [params, setParams] = useState<OcrAnalysisParams>({
    best_mode: true,
    filename: "",
    template_type: "BEA",
    oem: "3",
    psm: " ",
    lang: ["eng", "chi_sim", "chi_tra"],
  })

  const langOptions = [
    { value: "chi_sim", label: "Simplified Chinese" },
    { value: "chi_tra", label: "Traditional Chinese" },
    { value: "eng", label: "English" },
  ]
  const psmOptions = [
    { value: " ", label: "default", description: "" }, //TODO
    { value: "3", label: "PSM 3", description: "Mixed Content documents" },
    { value: "6", label: "PSM 6", description: "Tables & Forms" },
    { value: "7", label: "PSM 7", description: "Unique Document Layouts" },
    { value: "11", label: "PSM 11", description: "Scattered Text documents" },
  ]
  const oemOptions = [
    { value: "0", label: "OEM 0", description: "Classic OCR Engine" },
    { value: "1", label: "OEM 1", description: "LSTM Neural Network" },
    { value: "2", label: "OEM 2", description: "Combined OCR Engines" },
    { value: "3", label: "OEM 3", description: "Auto-Select Best Engine" },
  ]

  const navigate = useNavigate()
  useEffect(() => {
    if (!isAuthenticated()) {
      toast("Please log in to access this page")
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
      setIsPreviewing(false)
      setImagePreview(res)
      setSummaryStatistics(null)
      setResponseData(null)
    })
    toast.success("Files uploaded successfully")
  }

  // Process image
  const processImage = async () => {
    if (!selectedImage) {
      toast.error("Please upload an image first")
      return
    }

    setIsProcessing(true)
    try {
      const result = await fetchOCRAnalysis(selectedImage, params)

      let _responseData = []
      let _list = []
      result.forEach((item) => {
        _list.push({
          filename: item.filename,
          content: item.text,
          details: [
            {
              type: "Cashflow Consistency Check",
              result: item.amount_alert,
              alert: item.amount_alert_message?.join(",") || "N/A",
              fraud: item.potential_fraud,
            },
            {
              type: "Date Alignment Verification",
              result: item.date_alert,
              alert: item.date_alert_message?.join(",") || "N/A",
              fraud: item.potential_fraud,
            },
            {
              type: "Description Accuracy Audit (Optional)",
              result: item.desc_alert,
              alert: item.desc_alert_message?.join(",") || "N/A",
              fraud: item.potential_fraud,
            },
          ],
        })
      })

      setSummaryStatistics(_list)
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

  const handleUseMaskChange = (checked: boolean) => {
    setUseMask(checked)
    if (!checked) {
      // setMaskFile(null);
      // setMaskPreview(null);
    }
  }
  const handleMaskFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files || null
    if (!files.length) return
    const fileArray = Array.from(files)
    // setMaskFile(fileArray);
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

  const handleExportCSV = () => {
    // Filter files with valid results
    // const validFiles = SummaryStatistics.filter(file => file.result && file.result !== 'pending');
    if (summaryStatistics.length === 0) {
      toast.error("Please analyze images before exporting results")
      return
    }

    // CSV header
    const headers = [
      "",
      "Algorithm",
      "Pass / Fail Test",
      "Alert Messages",
      "Potential Fraud",
    ]

    // 生成多个 sheet 的 CSV 内容
    const sheets = []
    // Add data rows
    summaryStatistics.forEach((file) => {
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
    link.download = "Text Consistency Checker.csv"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    toast.success("Results have been exported as CSV")
  }

  const setSelectedValues = (value) => {
    setParams({ ...params, lang: value })
    console.log(value, params)
  }

  return (
    <div className="container max-w-full px-2 py-3 md:px-6">
      <h1 className="text-2xl font-bold text-foreground mb-4">
        Text Consistency Checker
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
        <CardContent className="bg-white p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Image Upload Section */}
            <div className="space-y-3 ">
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
                  <Label htmlFor="use-mask" className="text-sm text-slate-600">
                    Template On/Off
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
                    onChange={handleImageUpload}
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

            <div className="space-y-6 ">
              <div className="flex flex-wrap gap-3 items-center">
                <div className=" gap-3 w-full">
                  {/* Oem Control */}
                  <div className="p-3 border border-slate-200 rounded-lg shadow-sm  w-full">
                    <div className="flex items-center gap-1 mb-2">
                      <Label className="text-sm font-medium">
                        OCR Engine Mode (OEM)
                      </Label>
                    </div>
                    <Select
                      value={params.oem}
                      onValueChange={(value) =>
                        setParams((prev) => ({ ...prev, oem: value }))
                      }
                    >
                      <SelectTrigger className="w-full bg-white border-slate-200 h-10">
                        <SelectValue placeholder="Select algorithm" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {oemOptions.map((option) => (
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
                <div className=" gap-3  w-full">
                  {/* Psm Control */}
                  <div className="p-3 border border-slate-200 rounded-lg shadow-sm  w-full">
                    <div className="flex items-center gap-1 mb-2">
                      <Label className="text-sm font-medium">
                        Page Segmentation Mode (PSM)
                      </Label>
                    </div>
                    <Select
                      value={params.psm}
                      onValueChange={(value) =>
                        setParams((prev) => ({ ...prev, psm: value }))
                      }
                    >
                      <SelectTrigger className="w-full bg-white border-slate-200 h-10">
                        <SelectValue placeholder="Select Page Segmentation Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {psmOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>{option.label}</span>
                                  </TooltipTrigger>
                                  {option.description ? (
                                    <TooltipContent
                                      side="right"
                                      className="bg-slate-800 text-white border-slate-700"
                                    >
                                      <p>{option.description}</p>
                                    </TooltipContent>
                                  ) : (
                                    <></>
                                  )}
                                </Tooltip>
                              </TooltipProvider>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 grid grid-cols-1  relative ">
              {/* Lang */}
              <div className="relative p-3 border border-slate-200 rounded-lg shadow-sm  w-full">
                <Label
                  htmlFor="detector"
                  className="text-sm font-medium text-slate-700 mb-2 block"
                >
                  Language
                </Label>
                <MultiSelect
                  options={langOptions}
                  placeholder="Please Select Lang"
                  className="w-full"
                  defaultValue={params.lang}
                  value={params.lang}
                  onChange={(value) =>
                    setParams((prev) => ({ ...prev, lang: value }))
                  }
                />
                {/* <Select
                    value={params.lang }
                    onValueChange={(value) => setParams(prev => ({ ...prev, lang:value }))}
                  >
                    <SelectTrigger className="w-full bg-white border-slate-200 h-10">
                      <SelectValue placeholder="Select algorithm" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {langOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            <span>{option.label}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select> */}
              </div>
              <div className="grid grid-cols-2 gap-5">
                {/* Template Type */}
                <div className="relative p-3 border border-slate-200 rounded-lg shadow-sm  w-full">
                  <Label
                    htmlFor="detector"
                    className="text-sm font-medium text-slate-700 mb-2 block"
                  >
                    Template Type
                  </Label>
                  <Select
                    value={params.template_type || undefined}
                    onValueChange={(value) =>
                      setParams((prev) => ({ ...prev, template_type: value }))
                    }
                  >
                    <SelectTrigger className="w-full bg-white border-slate-200 h-10">
                      <SelectValue placeholder="Select template type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="BEA">
                          <span>BEA</span>
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col ">
                  {/* Inclusive Checkbox - Modern styling */}
                  <div className=" border-l border-border/30 w-full ">
                    <div className="flex items-center w-full bg-secondary/50 px-2.5 py-1 rounded-md">
                      <Checkbox
                        id="mode"
                        checked={params.best_mode}
                        onCheckedChange={(checked) =>
                          setParams((prev) => ({
                            ...prev,
                            mode: checked === true,
                          }))
                        }
                        className="h-3.5 w-3.5 rounded-sm"
                      />
                      <Label
                        htmlFor="Best Mode"
                        className="ml-1 text-xs cursor-pointer"
                      >
                        Best Mode
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
                            <p>
                              Consider choosing a larger model to enhance
                              accuracy.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                  <Button
                    onClick={processImage}
                    disabled={!selectedImage || isProcessing}
                    size="sm"
                    className=" bg-primary hover:bg-primary/90 shadow-sm relative mt-2 "
                  >
                    {isProcessing ? "Processing..." : "Process Image"}
                  </Button>
                  <Button
                    onClick={handleExportCSV}
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto mt-2"
                    disabled={
                      isProcessing ||
                      (summaryStatistics && summaryStatistics.length === 0)
                    }
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Export Results
                  </Button>
                </div>
              </div>
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
                    className="p-0 relative"
                    ref={originalContainerRef}
                  >
                    <ImageViewer
                      className="h-[800px] "
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
        <Card className=" flex flex-col h-full shadow-sm border-opacity-40  card-gradient-warm lg:col-span-1">
          <CardHeader className="py-2 px-3 border-b border-border/40 bg-background/50 ">
            <CardTitle className="text-sm font-medium flex items-center">
              <span className="h-2 w-2 rounded-full bg-blue-500 mr-2"></span>
              Processed Output
            </CardTitle>
          </CardHeader>
          <CardContent
            className={`${summaryStatistics && summaryStatistics.length > 0 ? " bg-slate-100" : ""} p-3 flex-grow  relative`}
            ref={processedContainerRef}
          >
            {isProcessing ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-background/50">
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
            ) : summaryStatistics && summaryStatistics.length ? (
              summaryStatistics.map((item, index) => (
                <p
                  className="h-[800px]  text-sm overflow-auto p-3 bg-white mb-3"
                  key={index}
                  dangerouslySetInnerHTML={{ __html: item.content }}
                ></p>
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
        </Card>

        {/* Statistics Section - Right Column */}
        <Card className="overflow-hidden1 flex flex-col h-full shadow-sm border-opacity-40 bg-gradient-to-br from-slate-50 to-slate-100 lg:col-span-1">
          <CardHeader className="py-2 px-3 border-b border-border/40 bg-background/50">
            <CardTitle className="text-sm font-medium flex items-center">
              <span className="h-2 w-2 rounded-full bg-violet-500 mr-2"></span>
              Text consistency check
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 flex-grow overflow-auto">
            {summaryStatistics && summaryStatistics.length > 0 ? (
              summaryStatistics.map((summary, index) => (
                <div
                  className="space-y-6 h-[800px]"
                  key={summary.filename + index}
                >
                  {/* Summary Card */}
                  <Card className="bg-white shadow-sm ">
                    <CardContent className="p-4">
                      {/* <div className="text-sm font-medium mb-2 text-muted-foreground">Summary</div> */}
                      {/* <div className="grid grid-cols-3 gap-4"> */}
                      <div className="text-center flex">
                        <label className="text-sm text-muted-foreground mr-2">
                          Filename :{" "}
                        </label>
                        <span
                          className="text-sm font-medium truncate"
                          title={summary?.filename}
                        >
                          {summary?.filename || "N/A"}
                        </span>
                      </div>
                      {/* </div> */}
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
                            Algorithm
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
                    Upload and process an image to view detailed Text
                    consistency check.
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

export default OCRAnalysis
