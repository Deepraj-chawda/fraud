import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Download, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import UploadModal from "@/components/UploadModal";
import EmptyState from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { uploadImageAndGetMetadata } from "@/api/services/metaData";
import { isAuthenticated } from "@/api/auth";
import { useNavigate } from "react-router-dom";

interface MetadataResponse {
  [section: string]: [string, string][];
}

interface Image {
  id: string;
  name: string;
  url: string;
  thumbnail: string;
  exifApiData?: MetadataResponse;
  headerApiData?: string;
}

const Metadata = () => {
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [images, setImages] = useState<Image[]>([]);
  const [selectedImage, setSelectedImage] = useState<Image | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showZoomControls, setShowZoomControls] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [isLoading, setIsLoading] = useState(false);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated()) {
      toast({
        title: "Authentication required",
        description: "Please log in to access this page",
        variant: "destructive",
      });
      navigate("/login");
    }
  }, [navigate, toast]);

  useEffect(() => {
    setImagePosition({ x: 0, y: 0 });
  }, [selectedImage]);

  const fetchImageMetadata = async (image: Image) => {
    setIsLoading(true);

    try {
      const response = await fetch(image.url);
      const blob = await response.blob();
      const file = new File([blob], image.name, { type: blob.type });

      const { exifData, headerData } = await uploadImageAndGetMetadata(file);

      // Update images state
      setImages((prevImages) =>
        prevImages.map((img) =>
          img.id === image.id
            ? { ...img, exifApiData: exifData, headerApiData: headerData }
            : img
        )
      );

      // Update selectedImage immediately
      setSelectedImage((prev) =>
        prev && prev.id === image.id
          ? { ...prev, exifApiData: exifData, headerApiData: headerData }
          : prev
      );

      toast({
        title: "Metadata retrieved",
        description: `Successfully fetched metadata for ${image.name}`,
      });
    } catch (error) {
      console.error("Error fetching metadata:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to fetch metadata",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUploadComplete = (files: File[]) => {
    // Supported image MIME types
    const supportedImageTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/tiff",
      "image/bmp",
    ];

    // Filter only image files
    const imageFiles = files.filter((file) =>
      supportedImageTypes.includes(file.type)
    );

    if (imageFiles.length === 0) {
      toast({
        title: "No images found",
        description:
          "Please select a folder containing supported images (JPEG, PNG, GIF, TIFF, BMP)",
        variant: "destructive",
      });
      return;
    }

    const newImages = imageFiles.map((file, index) => ({
      id: `img-${Date.now()}-${index}`,
      name: file.name,
      url: URL.createObjectURL(file),
      thumbnail: URL.createObjectURL(file),
    }));

    setImages((prev) => [...prev, ...newImages]);

    if (newImages.length > 0) {
      const firstImage = newImages[0];
      setSelectedImage(firstImage);
      fetchImageMetadata(firstImage);
    }

    toast({
      title: "Upload complete",
      description: `${imageFiles.length} ${
        imageFiles.length === 1 ? "image" : "images"
      } processed successfully`,
    });
  };

  const handleImageSelect = (image: Image) => {
    setSelectedImage(image);
    if (!image.exifApiData || !image.headerApiData) {
      fetchImageMetadata(image); // Fetch if not already loaded
    }
  };

  const handleExport = () => {
    if (!selectedImage?.headerApiData) {
      toast({
        title: "Error",
        description: "No header structure data available to export",
        variant: "destructive",
      });
      return;
    }

    const blob = new Blob([selectedImage.headerApiData], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `headerstructure-${selectedImage.name.replace(
      /\.[^/.]+$/,
      ""
    )}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Success",
      description: "Header structure exported successfully",
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " bytes";
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    else return (bytes / 1048576).toFixed(1) + " MB";
  };

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleResetZoom = () => {
    setZoomLevel(1);
    setImagePosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel > 1) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - imagePosition.x,
        y: e.clientY - imagePosition.y,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoomLevel > 1) {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;

      const container = imageContainerRef.current;
      const image = imageRef.current;

      if (container && image) {
        const containerRect = container.getBoundingClientRect();
        const maxX = (image.width * zoomLevel - containerRect.width) / 2;
        const maxY = (image.height * zoomLevel - containerRect.height) / 2;

        const boundedX = Math.max(-maxX, Math.min(maxX, newX));
        const boundedY = Math.max(-maxY, Math.min(maxY, newY));

        setImagePosition({ x: boundedX, y: boundedY });
      }
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b bg-white p-3 flex justify-between items-center shadow-sm">
        <h1 className="text-2xl font-bold text-foreground">Get Metadata</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex items-center gap-2"
            onClick={() => setUploadModalOpen(true)}
            size="sm"
          >
            <Upload className="h-4 w-4" /> Upload Images
          </Button>
          <Button
            variant="outline"
            className="flex items-center gap-2"
            disabled={!selectedImage || !selectedImage.headerApiData}
            onClick={handleExport}
            size="sm"
          >
            <Download className="h-4 w-4" /> Export Header Structure
          </Button>
        </div>
      </div>

      {images.length === 0 ? (
        <EmptyState
          icon=""
          title="No Images Uploaded"
          description="Upload images to view and extract metadata."
          onUploadClick={() => setUploadModalOpen(true)}
        />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="w-44 border-r overflow-y-auto p-2 bg-slate-50">
            <div className="space-y-2">
              {images.map((image) => (
                <div
                  key={image.id}
                  className={`flex items-center justify-center p-1 rounded hover:bg-slate-100 cursor-pointer transition-all duration-200 ${
                    selectedImage?.id === image.id ? "bg-slate-100" : ""
                  }`}
                  onClick={() => handleImageSelect(image)}
                >
                  <div className="relative w-40 h-36 flex-shrink-0">
                    <img
                      src={image.thumbnail}
                      alt={image.name}
                      className={`w-full h-full object-fill rounded ${
                        selectedImage?.id === image.id
                          ? "ring-2 ring-gray-900 shadow-md"
                          : "ring-1 ring-slate-200"
                      }`}
                      title={image.name}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className="flex-1 overflow-hidden flex items-center justify-center bg-slate-100 py-4 px-2 relative  mx-auto"
            onMouseEnter={() => setShowZoomControls(true)}
            onMouseLeave={() => {
              setShowZoomControls(false);
              setIsDragging(false);
            }}
            ref={imageContainerRef}
            onMouseUp={handleMouseUp}
          >
            {selectedImage && (
              <div
                className={`max-w-full max-h-full overflow-hidden rounded-lg shadow-md ${
                  isDragging
                    ? "cursor-grabbing"
                    : zoomLevel > 1
                    ? "cursor-grab"
                    : "cursor-default"
                } select-none`}
                style={{
                  transform: `scale(${zoomLevel})`,
                  transformOrigin: "center",
                  transition: isDragging ? "none" : "transform 0.3s ease",
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
              >
                <img
                  ref={imageRef}
                  src={selectedImage.url}
                  alt={selectedImage.name}
                  className="w-auto h-auto max-h-[90vh] max-w-full object-contain"
                  style={{
                    transform: `translate(${imagePosition.x}px, ${imagePosition.y}px)`,
                    transition: isDragging ? "none" : "transform 0.3s ease",
                  }}
                  draggable={false}
                />
              </div>
            )}

            {selectedImage && (
              <div
                className={`absolute bottom-6 right-6 bg-white/90 backdrop-blur-sm rounded-lg p-2 flex items-center gap-1.5 shadow-lg transition-opacity duration-300 ${
                  showZoomControls
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-4"
                }`}
              >
                <button
                  onClick={handleZoomOut}
                  className="p-2 hover:bg-slate-100 rounded-md transition-colors text-gray-800"
                  title="Zoom Out"
                >
                  <ZoomOut size={18} />
                </button>
                <span className="text-xs text-gray-600 font-medium w-12 text-center">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  className="p-2 hover:bg-slate-100 rounded-md transition-colors text-gray-800"
                  title="Zoom In"
                >
                  <ZoomIn size={18} />
                </button>
                <button
                  onClick={handleResetZoom}
                  className="p-2 hover:bg-slate-100 rounded-md transition-colors text-gray-800 ml-1 border-l border-gray-200"
                  title="Reset Zoom"
                >
                  <Maximize size={18} />
                </button>
              </div>
            )}

            {isLoading && (
              <div className="absolute inset-0 bg-black/10 backdrop-blur-sm flex items-center justify-center">
                <div className="bg-white p-4 rounded-lg shadow-lg flex flex-col items-center">
                  <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <p className="mt-2 text-sm font-medium">
                    Fetching metadata...
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="w-[30%] border-l overflow-y-auto bg-white shadow-md p-4">
            <h5 className="mb-4 text-primary border-b pb-3 bg-gray-100 px-3 rounded shadow-sm">
              METADATA Flag Details
            </h5>
            {selectedImage && selectedImage.exifApiData ? (
              <div className="flex flex-col gap-8">
                {Object.entries(selectedImage.exifApiData).map(
                  ([section, pairs]) => (
                    <div
                      key={section}
                      className="flex flex-col bg-slate-50 rounded-lg px-2 py-4 shadow-sm"
                    >
                      <h6 className="text-primary font-semibold mb-3">
                        {section}
                      </h6>
                      <div className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2">
                        {pairs.map(([key, value]) => (
                          <React.Fragment key={key}>
                            <span className="text-blue-600 font-bold text-sm">
                              {key}
                            </span>
                            <span
                              className="text-gray-600 text-sm truncate text-wrap"
                              title={value}
                            >
                              {value || "N/A"}
                            </span>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            ) : (
              <div className="alert alert-warning text-center" role="alert">
                <i className="bi bi-exclamation-circle-fill text-warning mr-2"></i>{" "}
                No details available
              </div>
            )}
          </div>
        </div>
      )}

      {/* UploadModal with forceMultiple={true} enables folder selection for batch processing */}
      <UploadModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        onUploadComplete={handleUploadComplete}
        forceMultiple={true}
      />
    </div>
  );
};

export default Metadata;
