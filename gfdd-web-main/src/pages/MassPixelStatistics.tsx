import React, { useState, useEffect, useRef } from "react"
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
import { Info } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import MultiSelect from "@/components/ui/multiSelect"
import { toast } from "sonner"
import { fetchOCRAnalysis } from "@/api/services/ocrAnalysis"
import { fetchAsyncImageStats } from "@/api/services/imageStats"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OcrAnalysisParams, ProcessingMode } from "../types/apiTypes"
import { isAuthenticated } from "@/api/auth"
import { useNavigate } from "react-router-dom"
import { useToast } from "@/hooks/use-toast"
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

const MassUpload = () => {
  // State management
  const [selectedImage, setSelectedImage] = useState<File[] | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [toolMode, setToolMode] = useState("pixel")
  const [inclusive, setInclusive] = useState<boolean>(false)
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
    { value: " ", label: "default", description: "" },
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

  // const { toast } = useToast()
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
    console.log(fileArray, 7766)
    //  const res= validateFileImagePdf(fileArray);
    //  if(!res.flag){
    //   toast.error(res.message)
    //   return
    //  }
    setSelectedImage(fileArray)
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
      if (toolMode === "pixel") {
        await fetchAsyncImageStats(selectedImage, inclusive)
      } else {
        // const result = await fetchOCRAnalysis(selectedImage, inclusive)
      }
      setIsProcessing(false)
      toast.success(
        "The asynchronous image processing process has been successfully initiated!"
      )
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
  }

  return (
    <div className="container max-w-full px-2 py-3 md:px-6">
      <h1 className="text-2xl font-bold text-foreground mb-4">
        Mass Upload Tools
      </h1>
      <Tabs
        value={toolMode}
        onValueChange={(value) => setToolMode(value)}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2 mb-0">
          <TabsTrigger value="pixel">Pixel & AI Analysis</TabsTrigger>
          <TabsTrigger value="ocr">Text Consistency Checker</TabsTrigger>
        </TabsList>
        <TabsContent value="pixel" className="mt-0">
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
                <div>
                  <div className="relative">
                    <Input
                      id="image-upload"
                      type="file"
                      accept="image/*,application/pdf,application/zip"
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
                </div>

                <div className="space-y-3  flex flex-col justify-end w-1/2">
                  {/* Inclusive Checkbox - Modern styling */}
                  <div className=" border-l border-border/30 w-full ">
                    <div className="flex items-center w-full bg-secondary/50 px-2.5 py-1 rounded-md">
                      <Checkbox
                        id="mode"
                        checked={inclusive}
                        onCheckedChange={(checked) =>
                          setInclusive(Boolean(checked))
                        }
                        className="h-3.5 w-3.5 rounded-sm"
                      />
                      <Label
                        htmlFor="Best Mode"
                        className="ml-1 text-xs cursor-pointer"
                      >
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
                            <p>
                              Consider choosing a larger model to enhance
                              accuracy.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <Button
                      onClick={processImage}
                      disabled={!selectedImage || isProcessing}
                      size="sm"
                      className=" bg-primary hover:bg-primary/90 shadow-sm relative mt-2 "
                    >
                      {isProcessing ? "Processing..." : "Process Image"}
                    </Button>
                    {/* <Button 
                        onClick={handleExportCSV}
                        variant="outline"
                        size="sm"
                        className="w-full sm:w-auto mt-2"
                        disabled={isProcessing || summaryStatistics&&summaryStatistics.length === 0}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Export Results
                      </Button> */}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ocr">
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
                      <Label
                        htmlFor="use-mask"
                        className="text-sm text-slate-600"
                      >
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
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
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
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
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
                          setParams((prev) => ({
                            ...prev,
                            template_type: value,
                          }))
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
                    <div className="flex flex-col justify-end">
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
                      {/* <Button 
                          onClick={handleExportCSV}
                          variant="outline"
                          size="sm"
                          className="w-full sm:w-auto mt-2"
                          disabled={isProcessing || summaryStatistics&&summaryStatistics.length === 0}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Export Results
                        </Button> */}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default MassUpload
