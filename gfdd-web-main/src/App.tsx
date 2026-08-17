import { Toaster } from "@/components/ui/toaster"
import { Toaster as Sonner } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import Index from "./pages/Index"
import Login from "./pages/Login"
import Metadata from "./pages/Metadata"
import AIDetection from "./pages/AIDetection"
import FaceRecognition from "./pages/FaceRecognition"
import NotFound from "./pages/NotFound"
import Navigation from "./components/Navigation"
import { useAutoLogout } from "@/hooks/useAutoLogout"
import { AutoLogoutHandler } from "./components/AutoLogoutHandler"
import PixelStatistics from "./pages/PixelStatistics"
import CopyMoveForgery from "./pages/CopyMoveForgery"
import EdgeDetection from "./pages/EdgeDetection"
import ErrorLevelAnalysis from "./pages/ErrorLevelAnalysis"
import PCAProjection from "./pages/PCAProjection"
import Dashboard from "./pages/Dashboard"
import OCRAnalysis from "./pages/OCRAnalysis"
import MassPixelStatistics from "./pages/MassPixelStatistics"
import Dashboard4MassUpload from "./pages/Dashboard4MassUpload"

// Add Inter font import
const interFontLink = document.createElement("link")
interFontLink.rel = "stylesheet"
// interFontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap';
interFontLink.href =
  "https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900&family=Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap"
document.head.appendChild(interFontLink)

const queryClient = new QueryClient()

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AutoLogoutHandler />
          <div className="min-h-screen flex flex-col">
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="*"
                element={
                  <>
                    <Navigation />
                    <div className="flex-grow">
                      <Routes>
                        <Route path="/" element={<Login />} />
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/metadata" element={<Metadata />} />
                        <Route path="/detect-ai" element={<AIDetection />} />
                        <Route
                          path="/face-recognition"
                          element={<FaceRecognition />}
                        />
                        <Route
                          path="/pixel-statistics"
                          element={<PixelStatistics />}
                        />
                        <Route
                          path="/copy-move-forgery"
                          element={<CopyMoveForgery />}
                        />
                        <Route
                          path="/edge-detection"
                          element={<EdgeDetection />}
                        />
                        <Route
                          path="/error-level-analysis"
                          element={<ErrorLevelAnalysis />}
                        />
                        <Route path="/ocr-analysis" element={<OCRAnalysis />} />
                        <Route
                          path="/Pca-projection"
                          element={<PCAProjection />}
                        />
                        <Route
                          path="/mass-pixel-statistics"
                          element={<MassPixelStatistics />}
                        />
                        <Route
                          path="/dashboard-4-mass-upload"
                          element={<Dashboard4MassUpload />}
                        />

                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </div>
                  </>
                }
              />
            </Routes>
          </div>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App
