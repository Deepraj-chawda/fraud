import React, { useState, useRef, useEffect } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Image,
  BarChart3,
  CheckCircle,
  XCircle,
  TrendingUp,
  Activity,
  AlertTriangle,
  Download,
} from "lucide-react"
import { getMassUploadModulesApi, fetchBatchResults } from "@/api/services/dashboard"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { isAuthenticated } from "@/api/auth"
import * as XLSX from "xlsx"

interface ResponseTable {
  id: number
  module: string
  processed: number
  success: number
  failure: number
  successRate: number
  uploadTime: string
}
interface OverallStats {
  totalFiles: number
  successful: number
  failed: number
  successRate: string
  failRate: string
}
// Helper function to flatten the JSON and generate the Excel file
const generateExcelAndDownload = (batchData: any) => {
  // 1. Flatten the data: Turn the nested JSON into a flat table (one row per PAGE)
  const flatData: any[] = []

  const batchInfo = {
    batch_id: batchData.batch_id,
    batch_name: batchData.batch_name,
    batch_created_at: batchData.created_at,
  }

  for (const doc of batchData.documents) {
    const docInfo = {
      document_id: doc.document_id,
      filename: doc.filename,
      filetype: doc.filetype,
    }

    for (const page of doc.pages) {
      
      page.analysis = JSON.parse(page.analysis)
    
      // Combine all info for this page
      const pageRow = {
        ...batchInfo,
        ...docInfo,
        page_number: page.page_number,
        detection_status: page.detection_status,
        component: page.analysis.component,
        module_name: page.analysis.module_name,
        alert_summary: JSON.stringify(page.analysis.alert_summary),
        is_potential_fraud: page.analysis.is_potential_fraud,
      }
      flatData.push(pageRow)
    }
  }

  if (flatData.length === 0) {
    toast.error("No data available to export for this batch.")
    return
  }

  // 2. Create a new Workbook
  const wb = XLSX.utils.book_new()

  // 3. Create a Worksheet from our flattened data
  const ws = XLSX.utils.json_to_sheet(flatData)

  // 4. Add the Worksheet to the Workbook
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    `Batch ${batchData.batch_id} Results`
  )

  // 5. Trigger the download
  XLSX.writeFile(wb, `batch_${batchData.batch_id}_results.xlsx`)
}

const Dashboard = () => {
  const [moduleData, setModuleData] = useState<ResponseTable[]>([])
  const [overallStats, setOverallStats] = useState<OverallStats>(null)
const [exportingId, setExportingId] = useState<number | null>(null)

  useEffect(() => {
    getAllModules()
  }, [])

  const navigate = useNavigate()
  useEffect(() => {
    console.log()
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

  const getAllModules = async () => {
    const res = await getMassUploadModulesApi()

    const data = res.batch_stats?.map((v) => ({
      id: v.batch_id,
      module: v.batch_name,
      processed: v.total_files,
      success: v.success_files,
      failure: v.failed_files,
      uploadTime: v.created_at,
      successRate: v.success_rate * 100,
    }))
    setModuleData(data)
    const overallStats = {
      totalFiles: res.overall_stats?.total_files,
      successful: res.overall_stats?.success_files,
      failed: res.overall_stats?.total_files,
      successRate: (res.overall_stats?.success_rate * 100).toFixed(2),
      failRate: ((1 - res.overall_stats?.success_rate) * 100).toFixed(2),
    }
    setOverallStats(overallStats)
  }

// Updated handleExportCSV function
  const handleExportCSV =
    (data: ResponseTable) =>
    async (event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation() // Prevent row click, etc.

      if (exportingId === data.id) return // Prevent double-clicks

      setExportingId(data.id)
      const toastId = toast.loading(`Fetching results for batch ${data.id}...`)

      try {
        // 1. Call the API to get the JSON data
        const batchResults = await fetchBatchResults(data.id)

        toast.loading(`Generating Excel file...`, { id: toastId })

        // 2. Generate and download the Excel file
        generateExcelAndDownload(batchResults)

        toast.success(`Batch ${data.id} results exported!`, {
          id: toastId,
        })
      } catch (error) {
        console.error("Export failed:", error)
        toast.error(
          error instanceof Error ? error.message : "An unknown error occurred",
          { id: toastId }
        )
      } finally {
        setExportingId(null) // Clear the loading state for this row
      }
    }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center gap-3 mb-2">
            <BarChart3 className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">
              Mass Upload Progress
            </h1>
          </div>
          <p className="text-gray-600">
            Comprehensive overview of your mass upload process
          </p>
        </div>

        {/* Overall Performance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-blue-800">
                Total Files
              </CardTitle>
              <Image className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-900">
                {overallStats?.totalFiles}
              </div>
              <p className="text-xs text-blue-600 mt-1">Processed this month</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-green-800">
                Successful
              </CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-900">
                {overallStats?.successful}
              </div>
              <p className="text-xs text-green-600 mt-1">
                {overallStats?.successRate}% success rate
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-red-800">
                Failed
              </CardTitle>
              <XCircle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-900">
                {overallStats?.failed}
              </div>
              <p className="text-xs text-red-600 mt-1">
                {overallStats?.failRate}% failure rate
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-purple-800">
                Performance
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-900">
                {overallStats?.successRate}%
              </div>
              <p className="text-xs text-purple-600 mt-1">Overall efficiency</p>
            </CardContent>
          </Card>
        </div>

        {/* Module Performance Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-600" />
              Module Progress Overview
            </CardTitle>
            <CardDescription>
              Detailed breakdown by processing module
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Upload Time</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Files Processed</TableHead>
                  <TableHead>Success</TableHead>
                  <TableHead>Failure</TableHead>
                  <TableHead>Success Rate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Download csv</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {moduleData.map((module, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{module.id}</TableCell>
                    <TableCell className="font-medium">
                      {module.uploadTime}
                    </TableCell>
                    <TableCell className="font-medium">
                      {module.module}
                    </TableCell>
                    <TableCell>{module.processed}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-green-600 font-medium">
                          {module.success}
                        </span>
                        <Progress
                          value={(module.success / module.processed) * 100}
                          className="w-16 h-2"
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-red-600 font-medium">
                        {module.failure}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          module.successRate >= 98
                            ? "default"
                            : module.successRate >= 95
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {module.successRate}%
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {module.successRate >= 98 ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : module.successRate >= 95 ? (
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </TableCell>
                 
                    <TableCell className="font-medium text-blue-600">
                      <div
                        className={`flex items-center ${
                          exportingId === module.id
                            ? "opacity-50 cursor-not-allowed"
                            : "cursor-pointer"
                        }`}
                        onClick={handleExportCSV(module)}
                      >
                        {exportingId === module.id ? (
                          <Activity className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-4 w-4" />
                        )}
                        {exportingId === module.id
                          ? "Exporting..."
                          : "Export Results"}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default Dashboard
