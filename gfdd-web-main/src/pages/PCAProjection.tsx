/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from "react";
import { Upload, Download, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import ImageViewer from "@/components/copy-move-forgery/ImageViewer";
import { fetchPcaAnalysis } from "@/api/services/pcaAnalysis";

const PCAProjection = () => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [component, setComponent] = useState<string>("");
  const [mode, setMode] = useState<string>("");
  const [invert, setInvert] = useState<boolean>(false);
  const [equalize, setEqualize] = useState<boolean>(false);
  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [tableData, setTableData] = useState<any>(null);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedImageFile(file);
      const imageUrl = URL.createObjectURL(file);
      setSelectedImage(imageUrl);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedImageFile || !component || !mode) {
      toast.error("Please select an image, component, and mode");
      return;
    }

    setIsProcessing(true);

    // Map UI mode values to API-expected format
    const modeMap: { [key: string]: string } = {
      distance: "Distance",
      projection: "Projection",
      crossproduct: "Cross Product",
    };
    const apiMode = modeMap[mode.toLowerCase()] || mode;

    try {
      const response = await fetchPcaAnalysis(
        selectedImageFile,
        `#${component}`,
        apiMode,
        invert,
        equalize
      );
      setProcessedImageUrl(response.imageUrl);
      setTableData({
        meanVector: {
          red: response.pca_data.mean_vector[0],
          green: response.pca_data.mean_vector[1],
          blue: response.pca_data.mean_vector[2],
        },
        eigenvector1: {
          red: response.pca_data.eigenvectors[0][0],
          green: response.pca_data.eigenvectors[0][1],
          blue: response.pca_data.eigenvectors[0][2],
        },
        eigenvector2: {
          red: response.pca_data.eigenvectors[1][0],
          green: response.pca_data.eigenvectors[1][1],
          blue: response.pca_data.eigenvectors[1][2],
        },
        eigenvector3: {
          red: response.pca_data.eigenvectors[2][0],
          green: response.pca_data.eigenvectors[2][1],
          blue: response.pca_data.eigenvectors[2][2],
        },
        eigenvalues: {
          red: response.pca_data.eigenvalues[0],
          green: response.pca_data.eigenvalues[1],
          blue: response.pca_data.eigenvalues[2],
        },
      });
      toast.success("PCA analysis completed successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to complete PCA analysis");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (processedImageUrl) {
      const link = document.createElement('a');
      link.href = processedImageUrl;
      link.download = 'pca_processed_image.png';
      link.click();
      toast.success("Processed image exported");
    } else {
      toast.error("No processed image to export");
    }
  };

  const resetAll = () => {
    setSelectedImage(null);
    setSelectedImageFile(null);
    setComponent("");
    setMode("");
    setInvert(false);
    setEqualize(false);
    setProcessedImageUrl(null);
    setTableData(null);
    toast.success("Parameters reset to default");
  };

  const handleInvertChange = (checked: boolean | "indeterminate") => {
    setInvert(checked === true);
  };

  const handleEqualizeChange = (checked: boolean | "indeterminate") => {
    setEqualize(checked === true);
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4">
      <div className="mx-auto max-w-full space-y-4">
        {/* Header */}
          <h1 className="text-2xl mb-4 font-bold text-foreground">PCA Projection</h1>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Input Section */}
          <div className="lg:col-span-1 space-y-4">
            {/* Image Upload */}
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="space-y-3">
                  <label
                    htmlFor="image-upload"
                    className="flex h-48 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/20 transition-colors hover:border-muted-foreground/50 hover:bg-muted/30"
                  >
                    {selectedImage ? (
                      <div className="relative h-full w-full">
                        <img
                          src={selectedImage}
                          alt="Selected"
                          className="h-full w-full rounded-lg object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                          <span className="text-white text-sm font-medium">Click to change</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center">
                        <ImageIcon className="mx-auto h-12 w-12 text-muted-foreground" />
                        <p className="mt-2 text-sm text-muted-foreground">
                          <span className="font-medium">Click to upload</span> or drag and drop
                        </p>
                        <p className="text-xs text-muted-foreground">PNG, JPG, JPEG up to 10MB</p>
                      </div>
                    )}
                  </label>
                  <input
                    id="image-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Parameters */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Component */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Component</label>
                  <Select value={component} onValueChange={setComponent}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select component" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">#1</SelectItem>
                      <SelectItem value="2">#2</SelectItem>
                      <SelectItem value="3">#3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Mode */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Mode</label>
                  <Select value={mode} onValueChange={setMode}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="distance">Distance</SelectItem>
                      <SelectItem value="projection">Projection</SelectItem>
                      <SelectItem value="crossproduct">Cross Product</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Options */}
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="invert"
                      checked={invert}
                      onCheckedChange={handleInvertChange}
                    />
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <label htmlFor="invert" className="text-sm font-medium cursor-pointer">
                            Invert
                          </label>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Invert the PCA projection result</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="equalize"
                      checked={equalize}
                      onCheckedChange={handleEqualizeChange}
                    />
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <label htmlFor="equalize" className="text-sm font-medium cursor-pointer">
                            Equalize
                          </label>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Apply histogram equalization to the result</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleAnalyze}
                    disabled={!selectedImage || !component || !mode || isProcessing}
                    className="flex-1"
                  >
                    {isProcessing ? "Processing..." : "Analyze"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={resetAll}
                    className="flex-1"
                  >
                    Reset
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Output Section */}
          <div className="lg:col-span-3 space-y-4">
            {/* Images */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Original Image */}
              <Card className="shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Original Image</CardTitle>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="h-64 bg-muted rounded-lg overflow-hidden">
                    {selectedImage ? (
                      <ImageViewer
                        imageUrl={selectedImage}
                        altText="Original image"
                        type="original"
                        className="h-full"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <div className="text-center">
                          <ImageIcon className="mx-auto h-12 w-12 mb-2" />
                          <p className="text-sm">No image selected</p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Processed Image */}
              <Card className="shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Processed Image</CardTitle>
                    {processedImageUrl && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleDownload}
                        className="h-8"
                      >
                        <Download className="h-3 w-3 mr-1" />
                        Download
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="h-64 bg-muted rounded-lg overflow-hidden">
                    {processedImageUrl ? (
                      <ImageViewer
                        imageUrl={processedImageUrl}
                        altText="Processed image"
                        type="processed"
                        className="h-full"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <div className="text-center">
                          <ImageIcon className="mx-auto h-12 w-12 mb-2" />
                          <p className="text-sm">Process image to see result</p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Results Table */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">PCA Analysis Results</CardTitle>
              </CardHeader>
              <CardContent>
                {tableData ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Sr. No.</TableHead>
                          <TableHead>Element</TableHead>
                          <TableHead className="text-right">
                            <div className="flex items-center justify-end">
                              <div className="h-3 w-3 rounded-full bg-red-500 mr-2"></div>
                              <span>Red</span>
                            </div>
                          </TableHead>
                          <TableHead className="text-right">
                            <div className="flex items-center justify-end">
                            <div className="h-3 w-3 rounded-full bg-green-500 mr-2"></div>
                            <span>Green</span>
                          </div>
                          </TableHead>
                          <TableHead className="text-right">
                            <div className="flex items-center justify-end">
                              <div className="h-3 w-3 rounded-full bg-blue-500 mr-2"></div>
                            <span>Blue</span>
                          </div>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium">1</TableCell>
                          <TableCell>Mean Vector</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.meanVector.red.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.meanVector.green.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.meanVector.blue.toFixed(2)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">2</TableCell>
                          <TableCell>Eigenvector 1</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.eigenvector1.red.toFixed(3)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.eigenvector1.green.toFixed(3)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.eigenvector1.blue.toFixed(3)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">3</TableCell>
                          <TableCell>Eigenvector 2</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.eigenvector2.red.toFixed(3)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.eigenvector2.green.toFixed(3)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.eigenvector2.blue.toFixed(3)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">4</TableCell>
                          <TableCell>Eigenvector 3</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.eigenvector3.red.toFixed(3)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.eigenvector3.green.toFixed(3)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.eigenvector3.blue.toFixed(3)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">5</TableCell>
                          <TableCell>Eigenvalues</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.eigenvalues.red.toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.eigenvalues.green.toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {tableData.eigenvalues.blue.toFixed(1)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    <p className="text-sm">Analysis results will appear here after processing</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PCAProjection;