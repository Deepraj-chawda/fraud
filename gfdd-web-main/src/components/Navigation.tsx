import React, { useState, useEffect, useRef } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Users, Image, Bot, Menu, LogIn, BarChart3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { isAuthenticated } from "@/api/auth"
import { toast } from "sonner"

const Navigation = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const currentPath = location.pathname
  const [authenticated, setAuthenticated] = useState(isAuthenticated())

  // State to manage open dropdowns
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const isActive = (path: string) => currentPath === path
  const handleLogin = () => navigate("/login")

  const handleLogout = () => {
    localStorage.removeItem("access_token")
    localStorage.removeItem("access_token_timestamp")
    setAuthenticated(false)
    toast.success("Logged out successfully")
    navigate("/login", { replace: true })
  }

  useEffect(() => {
    if (!authenticated && currentPath === "/") {
      navigate("/login")
    }
  }, [authenticated])

  // Navigation menu items organized by categories
  const imageAnalysisTools = [
    { title: "AI Integrity Check", path: "/detect-ai", icon: Users },
    // { title: "Edge Detection", path: "/edge-detection", icon: Image },
    // { title: "PCA Projection", path: "/pca-projection", icon: Bot },
  ]

  const forgeryDetectionTools = [
    { title: "Edge Detection", path: "/edge-detection", icon: Image },
    { title: "Copy-Move Forgery", path: "/copy-move-forgery", icon: Users },
    {
      title: "Error Level Analysis",
      path: "/error-level-analysis",
      icon: Image,
    },
  ]
  const massUploadTools = [
    {
      title: "Mass Upload Progress",
      path: "/dashboard-4-mass-upload",
      icon: Users,
    },
    { title: "Mass upload ", path: "/mass-pixel-statistics", icon: Users },
    // { title: "Mass upload for OCR", path: "/mass", icon: Users },
  ]

  const aiRecognitionTools = [
    { title: "Text Consistency Checker", path: "/ocr-analysis", icon: Bot },
    // { title: "Face Recognition", path: "/face-recognition", icon: Users },
  ]

  const isActiveInCategory = (items: typeof imageAnalysisTools) => {
    return items.some((item) => isActive(item.path))
  }

  // Replicate NavigationMenuTrigger styling
  const triggerStyle = cn(
    "group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-accent/50"
  )

  // Hover handlers
  const handleMouseEnter = (dropdown: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setOpenDropdown(dropdown)
  }

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setOpenDropdown(null)
    }, 200) // 200ms delay for better UX
  }

  return (
    <div className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 ">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            {/* App Logo */}
            <Link to="/" className="flex items-center">
              <img src="/KPMGLogo.png" alt="Logo" className="h-20 w-20 mr-8" />
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:ml-16 md:flex items-center space-x-1">
              <Link to="/dashboard">
                <Button
                  variant="ghost"
                  className={cn(
                    "group inline-flex h-10 w-max items-center justify-center rounded-lg bg-transparent px-4 py-2 text-sm font-medium transition-all duration-200 hover:bg-gray-100 hover:text-gray-900 focus:bg-gray-100 focus:text-gray-900 focus:outline-none",
                    isActive("/dashboard") && "bg-accent text-accent-foreground"
                  )}
                >
                  <BarChart3 className="h-4 w-4  transition-colors" />
                  Dashboard
                </Button>
              </Link>

              {/* AI Integrity Check */}
              <Link to="/detect-ai">
                <Button
                  variant="ghost"
                  className={cn(
                    triggerStyle,
                    isActive("/detect-ai") && "bg-accent text-accent-foreground"
                  )}
                >
                  <Image className="h-4 w-4 " /> AI Integrity Check
                </Button>
              </Link>

              {/* Comprehensive Pixel & AI Analytical Suite */}
              <Link to="/pixel-statistics">
                <Button
                  variant="ghost"
                  className={cn(
                    triggerStyle,
                    isActive("/pixel-statistics") &&
                      "bg-accent text-accent-foreground"
                  )}
                >
                  <Image className="h-4 w-4 " /> Pixel & AI Analysis
                </Button>
              </Link>

              {/* Forgery Detection Dropdown */}
              <DropdownMenu
                open={openDropdown === "forgery-detection"}
                onOpenChange={(open) => !open && setOpenDropdown(null)}
              >
                <DropdownMenuTrigger
                  asChild
                  onMouseEnter={() => handleMouseEnter("forgery-detection")}
                  onMouseLeave={handleMouseLeave}
                >
                  <Button
                    variant="ghost"
                    className={cn(
                      triggerStyle,
                      isActiveInCategory(forgeryDetectionTools) &&
                        "bg-accent text-accent-foreground"
                    )}
                  >
                    <Bot className="h-4 w-4 " />
                    Fraud Visual Tools
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[300px] p-2 flex flex-col gap-1"
                  onMouseEnter={() => handleMouseEnter("forgery-detection")}
                  onMouseLeave={handleMouseLeave}
                >
                  {forgeryDetectionTools.map((item) => (
                    <DropdownMenuItem key={item.path} asChild>
                      <Link
                        to={item.path}
                        className={cn(
                          "flex items-center gap-2 w-full rounded-md p-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer",
                          isActive(item.path) &&
                            "bg-accent text-accent-foreground"
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.title}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Text Consistency Checker */}
              <Link to="/ocr-analysis">
                <Button
                  variant="ghost"
                  className={cn(
                    triggerStyle,
                    isActive("/ocr-analysis") &&
                      "bg-accent text-accent-foreground"
                  )}
                >
                  <Image className="h-4 w-4 " /> Text Consistency Checker
                </Button>
              </Link>

              {/* mass upload */}
              {/* <Link to="/Batch-analysis">
                <Button
                  variant="ghost"
                  className={cn(
                    triggerStyle,
                    isActive('/Batch-analysis') && 'bg-accent text-accent-foreground'
                  )}
                >
                  <Image className="h-4 w-4 " /> Batch Analysis
                </Button>
              </Link> */}

              {/* Forgery Detection Dropdown */}
              <DropdownMenu
                open={openDropdown === "mass-upload"}
                onOpenChange={(open) => !open && setOpenDropdown(null)}
              >
                <DropdownMenuTrigger
                  asChild
                  onMouseEnter={() => handleMouseEnter("mass-upload")}
                  onMouseLeave={handleMouseLeave}
                >
                  <Button
                    variant="ghost"
                    className={cn(
                      triggerStyle,
                      isActiveInCategory(massUploadTools) &&
                        "bg-accent text-accent-foreground"
                    )}
                  >
                    <Bot className="h-4 w-4 " />
                    Mass Upload Tools
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[300px] p-2 flex flex-col gap-1"
                  onMouseEnter={() => handleMouseEnter("mass-upload")}
                  onMouseLeave={handleMouseLeave}
                >
                  {massUploadTools.map((item) => (
                    <DropdownMenuItem key={item.path} asChild>
                      <Link
                        to={item.path}
                        className={cn(
                          "flex items-center gap-2 w-full rounded-md p-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer",
                          isActive(item.path) &&
                            "bg-accent text-accent-foreground"
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.title}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Right side - User menu */}
          <div className="hidden md:flex items-center space-x-2 ml-1">
            {!authenticated && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogin}
                className="flex items-center gap-2"
              >
                <LogIn className="h-4 w-4" />
                <span>Login</span>
              </Button>
            )}
            {authenticated && (
              <div className="flex items-center gap-2">
                {/* <Link to="/dashboard">
                  <Button
                    variant="ghost"
                    className={cn(
                      "group inline-flex h-10 w-max items-center justify-center rounded-lg bg-transparent px-4 py-2 text-sm font-medium transition-all duration-200 hover:bg-gray-100 hover:text-gray-900 focus:bg-gray-100 focus:text-gray-900 focus:outline-none",
                      isActive('/dashboard') && 'bg-accent text-accent-foreground'
                    )}
                  >
                    <BarChart3 className="h-4 w-4  transition-colors" /> 
                    Dashboard
                  </Button>
                </Link> */}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLogout}
                  className="flex items-center gap-2"
                >
                  <LogIn className="h-4 w-4" />
                  <span>Logout</span>
                </Button>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem asChild>
                  <Link to="/" className="flex items-center gap-2">
                    <Image className="h-4 w-4" /> Dashboard
                  </Link>
                </DropdownMenuItem>

                {/* <DropdownMenuItem asChild>
                  <Link to="/metadata" className="flex items-center gap-2">
                    <Image className="h-4 w-4" /> Metadata
                  </Link>
                </DropdownMenuItem> */}

                <DropdownMenuSeparator />
                {/* <DropdownMenuLabel>Image Analysis</DropdownMenuLabel> */}
                {imageAnalysisTools.map((item) => (
                  <DropdownMenuItem key={item.path} asChild>
                    <Link to={item.path} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" /> {item.title}
                    </Link>
                  </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator />
                <DropdownMenuLabel>Fraud Visual Tools</DropdownMenuLabel>
                {forgeryDetectionTools.map((item) => (
                  <DropdownMenuItem key={item.path} asChild>
                    <Link to={item.path} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" /> {item.title}
                    </Link>
                  </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator />
                {/* <DropdownMenuLabel>Text Consistency Checker</DropdownMenuLabel> */}
                {aiRecognitionTools.map((item) => (
                  <DropdownMenuItem key={item.path} asChild>
                    <Link to={item.path} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" /> {item.title}
                    </Link>
                  </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator />
                <DropdownMenuLabel>Mass Upload Tools</DropdownMenuLabel>
                {massUploadTools.map((item) => (
                  <DropdownMenuItem key={item.path} asChild>
                    <Link to={item.path} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" /> {item.title}
                    </Link>
                  </DropdownMenuItem>
                ))}
                {!authenticated && (
                  <DropdownMenuItem
                    onClick={handleLogin}
                    className="flex items-center gap-2"
                  >
                    <LogIn className="h-4 w-4" /> Login
                  </DropdownMenuItem>
                )}
                {authenticated && (
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="flex items-center gap-2"
                  >
                    <LogIn className="h-4 w-4" /> Logout
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Navigation
