import React, { useState, useRef, useEffect, MouseEvent } from "react";
import { ZoomIn, ZoomOut, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ImageViewerProps {
  imageUrl: string;
  altText: string;
  type?: "original" | "processed";
  className?: string;
  stats?: {
    red?: number;
    green?: number;
    blue?: number;
  };
  showStats?: boolean;
}

const ImageViewer: React.FC<ImageViewerProps> = ({
  imageUrl,
  altText,
  type = "original",
  className,
  stats,
  showStats = false,
}) => {
  const [scale, setScale] = useState<number>(1);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showStatsOverlay, setShowStatsOverlay] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = () => setScale((prev) => Math.min(prev + 0.25, 5));
  const handleZoomOut = () => setScale((prev) => Math.max(prev - 0.25, 0.5));
  const handleFitToScreen = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (isDragging && scale > 1) {
      setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const toggleStatsOverlay = () => {
    if (stats) {
      setShowStatsOverlay((prev) => !prev);
    }
  };

  // ✅ Manually add wheel event to prevent passive error
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newScale = Math.min(Math.max(scale + delta, 0.5), 5);
      setScale(newScale);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [scale]);

  const bgStyle =
    type === "processed" ? "bg-gradient-to-br from-blue-50 to-slate-100" : "bg-slate-100";

  const maxStat = stats ? Math.max(stats.red || 0, stats.green || 0, stats.blue || 0) : 0;

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden", bgStyle, className)}
      ref={containerRef}
    >
      <div className="absolute top-3 left-3 z-10">
        <Badge
          className={cn(
            "font-medium text-xs px-2.5 py-1 shadow-sm",
            type === "processed"
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-slate-700 hover:bg-slate-800"
          )}
        >
          {type === "processed" ? "Processed" : "Original"}
        </Badge>
      </div>

      {showStats && stats && type === "processed" && (
        <div className="absolute top-3 right-3 z-10">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant={showStatsOverlay ? "default" : "outline"}
                  className={cn(
                    "h-8 w-8 rounded-full shadow-sm",
                    showStatsOverlay
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-white/80 backdrop-blur-sm"
                  )}
                  onClick={toggleStatsOverlay}
                >
                  <BarChart2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle Statistics</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {showStats && stats && showStatsOverlay && (
        <div className="absolute bottom-14 right-3 z-20 bg-black/70 backdrop-blur-sm p-3 rounded-lg shadow-lg w-64">
          <h4 className="text-white text-sm font-medium mb-2">Pixel & AI Analysis</h4>
          <div className="space-y-2">
            {["red", "green", "blue"].map((color) => {
              const value = stats?.[color as keyof typeof stats] || 0;
              return (
                <div key={color}>
                  <div className="flex justify-between text-xs text-white mb-1">
                    <span>{color[0].toUpperCase() + color.slice(1)}</span>
                    <span>{value.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className={`h-full bg-${color}-500`}
                      style={{ width: `${(value / maxStat) * 100}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div
        className={`absolute w-full h-full flex items-center justify-center ${
          isDragging ? "cursor-grabbing" : scale > 1 ? "cursor-grab" : "cursor-default"
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        // ❌ Removed onWheel from here
      >
        <img
          src={imageUrl}
          alt={altText}
          className="transition-transform duration-200 max-h-full max-w-full object-contain"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: "center",
          }}
        />
      </div>

      {/* Zoom controls */}
      <div className="zoom-controls">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="zoom-button" onClick={handleZoomIn}>
                <ZoomIn className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom In</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="zoom-button" onClick={handleZoomOut}>
                <ZoomOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom Out</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="zoom-button" onClick={handleFitToScreen}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit to Screen</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
};

export default ImageViewer;
